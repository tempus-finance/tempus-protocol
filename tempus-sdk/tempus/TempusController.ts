import { Contract, Transaction } from "ethers";
import { Numberish, toWei } from "@tempus-labs/utils/ts/utils/DecimalUtils";
import { ContractBase, Signer, Addressable, addressOf } from "@tempus-labs/utils/ts/utils/ContractBase";
import { PoolType, TempusPool } from "./TempusPool";
import { PoolTestFixture } from "./PoolTestFixture";
import { constructPermit } from "@tempus-labs/utils/ts/token/PermitUtils";

/**
 * Wrapper around TempusController
 */
export class TempusController extends ContractBase {
  private static _contractName = "TempusController";
  private static _instance:TempusController;
  
  constructor(contractName: string, controller: Contract) {
    super(contractName, 18, controller);
  }

  /**
   * @returns The singleton instance of TempusController
   * @warning This cannot be used inside Test Fixture callback
   */
  static async instance(deployer?:Signer): Promise<TempusController> {
    if (!TempusController._instance) {
      TempusController._instance = await this.deploy(deployer);
    }
    return TempusController._instance;
  }

  /**
   * Deploys a new instance of TempusController
   */
  static async deploy(deployer?:Signer): Promise<TempusController> {
    const controller = await ContractBase.deployContractBy(TempusController._contractName, deployer);
    return new TempusController(TempusController._contractName, controller);
  }

  /**
   * Address string of the owner who deployed TempusController
   */
  async owner(): Promise<string> {
    return await this.contract.owner();
  }

  /**
   * Registers a POOL or an AMM as valid to use with this Controller
   * @param user Owner of TempusController
   * @param authorizedContract Address of the contract to authorize
   * @param isValid Is the contract authorized or not?
   */
  async register(user:Signer, authorizedContract:string, isValid:boolean = true): Promise<void> {
    await this.connect(user).register(authorizedContract, isValid);
  }

  /**
   * Deposits Yield Bearing Tokens into Tempus Pool on behalf of user
   * @param user User who is depositing
   * @param pool The Tempus Pool to which funds will be deposited
   * @param yieldBearingAmount Amount of Yield Bearing Tokens to deposit
   * @param recipient Address or User who will receive the minted shares
   * @param ethValue value of ETH to send with the tx
   */
  async depositYieldBearing(user:Signer, pool: TempusPool, yieldBearingAmount:Numberish, recipient:Addressable = user, ethValue: Numberish = 0): Promise<Transaction> {
    await pool.yieldBearing.approve(user, this.contract.address, yieldBearingAmount);
    return this.connect(user).depositYieldBearing(
      pool.address, pool.yieldBearing.toBigNum(yieldBearingAmount),
      addressOf(recipient), { value: toWei(ethValue) }
    );
  }

  /**
  * Deposits backing tokens into Tempus Pool on behalf of user
  * @param user User who is depositing
  * @param pool The Tempus Pool to which funds will be deposited
  * @param backingAmount Amount of Backing Tokens to deposit or ETH value if pool is Lido
  * @param recipient Address or User who will receive the minted shares
  * @param ethValue value of ETH to send with the tx
  */
  async depositBacking(user:Signer, pool: TempusPool, backingAmount:Numberish, recipient?:Addressable, ethValue?: Numberish): Promise<Transaction> {
    return this.connect(user).depositBacking(
      pool.address, pool.asset.toBigNum(backingAmount), addressOf(recipient ?? user),
      { value: toWei(pool.type === PoolType.Lido ? ethValue ?? backingAmount : ethValue ?? 0) }
    );
  }

  /**
   * Reedem shares from the Tempus Pool to Backing Tokens
   * @param user User who is redeeming
   * @param pool The Tempus Pool from which shares will be redeemed
   * @param principalAmount How many principal shares to redeem
   * @param yieldAmount How many yield shares to redeem
   * @param recipient The recipient address (can be user)
   */
  async redeemToBacking(user:Signer, pool: TempusPool, principalAmount:Numberish, yieldAmount:Numberish, recipient:Addressable): Promise<Transaction> {
    return this.connect(user).redeemToBacking(
      pool.address, pool.principalShare.toBigNum(principalAmount), pool.yieldShare.toBigNum(yieldAmount), addressOf(recipient)
    );
  }

  /**
   * Reedem shares from the Tempus Pool to Yield Bearing Tokens
   * @param user User who is redeeming
   * @param pool The Tempus Pool from which shares will be redeemed
   * @param principalAmount How many principal shares to redeem
   * @param yieldAmount How many yield shares to redeem
   * @param recipient The recipient address (can be user)
   */
  async redeemToYieldBearing(user:Signer, pool: TempusPool, principalAmount:Numberish, yieldAmount:Numberish, recipient:Addressable): Promise<Transaction> {
    return this.connect(user).redeemToYieldBearing(
      pool.address, pool.principalShare.toBigNum(principalAmount), pool.yieldShare.toBigNum(yieldAmount), addressOf(recipient)
    );
  }

  /**
   * Approves either BT or YBT transfer
   */
  async approve(pool:PoolTestFixture, user:Signer, amount:Numberish, isBackingToken:boolean) {
    const token = isBackingToken ? pool.asset : pool.ybt;
    await token.approve(user, this.address, amount);
  }

  /**
   * Atomically deposits YBT/BT to TempusPool
   *  and provides liquidity to the corresponding Tempus AMM with the issued TYS & TPS
   * @param user The user to deposit on behalf of
   * @param amm The Tempus AMM for which liquidity will be provided
   * @param tokenAmount Amount of BT/YBT to deposit
   * @param isBackingToken Specifies whether the deposited asset is YBT or BT
   * @param ethValue value of ETH to send with the tx
   */
  async depositAndProvideLiquidity(
    pool: PoolTestFixture,
    user: Signer,
    tokenAmount: Numberish,
    isBackingToken: boolean,
    ethValue: Numberish = 0
  ): Promise<Transaction> {
    await this.approve(pool, user, tokenAmount, isBackingToken);
    const amount = isBackingToken ? pool.tempus.asset.toBigNum(tokenAmount) : pool.ybt.toBigNum(tokenAmount);
    return this.connect(user).depositAndProvideLiquidity(
      pool.amm.address, pool.tempus.address, amount, isBackingToken, { value: toWei(ethValue) }
    );
  }

  /**
   * Atomically deposits YBT/BT to TempusPool and swaps TYS for TPS to get fixed yield
   * @param user The user to deposit on behalf of
   * @param amm The corresponding Tempus AMM to use to swap TYS for TPS
   * @param tokenAmount Amount of BT/YBT to deposit
   * @param isBackingToken Specifies whether the deposited asset is YBT or BT
   * @param minTYSRate Minimum TYS rate (denominated in TPS) to receive in exchange to TPS
   * @param ethValue value of ETH to send with the tx
   * @param deadline A timestamp by which the transaction must be completed, otherwise it would revert
   */
  async depositAndFix(
    pool: PoolTestFixture,
    user: Signer,
    tokenAmount: Numberish,
    isBackingToken: boolean,
    minTYSRate: Numberish,
    ethValue: Numberish = 0,
    deadline: Date = new Date(8640000000000000) /// default is 9/12/275760 (no deadline)
  ): Promise<Transaction> {
    await this.approve(pool, user, tokenAmount, isBackingToken);
    const amount = isBackingToken ? pool.tempus.asset.toBigNum(tokenAmount) : pool.ybt.toBigNum(tokenAmount);
    return this.connect(user).depositAndFix(
      pool.amm.address,
      pool.tempus.address,
      amount,
      isBackingToken,
      pool.tempus.asset.toBigNum(minTYSRate),
      parseInt((deadline.getTime() / 1000).toFixed(0)),
      { value: toWei(ethValue) }
    );
  }

  /**
   * Atomically deposits YBT/BT to TempusPool and swaps Capitals for Yields to get leveraged yield
   * @param user The user to deposit on behalf of
   * @param amm The corresponding Tempus AMM to use to swap Capitals for Yields
   * @param tokenAmount Amount of BT/YBT to deposit
   * @param isBackingToken Specifies whether the deposited asset is YBT or BT
   * @param maxCapitalsRate Minimum TYS rate (denominated in TPS) to receive in exchange to TPS
   * @param ethValue value of ETH to send with the tx
   * @param deadline A timestamp by which the transaction must be completed, otherwise it would revert
   */
   async depositAndLeverage(
    pool: PoolTestFixture,
    user: Signer,
    tokenAmount: Numberish,
    isBackingToken: boolean,
    leverageMultiplier: Numberish,
    minCapitalsRate: Numberish,
    ethValue: Numberish = 0,
    deadline: Date = new Date(8640000000000000) /// default is 9/12/275760 (no deadline)
  ): Promise<Transaction> {
    await this.approve(pool, user, tokenAmount, isBackingToken);
    const amount = isBackingToken ? pool.tempus.asset.toBigNum(tokenAmount) : pool.ybt.toBigNum(tokenAmount);
    return this.connect(user).depositAndLeverage(
      pool.amm.address,
      pool.tempus.address,
      toWei(leverageMultiplier),
      amount,
      isBackingToken,
      pool.tempus.asset.toBigNum(minCapitalsRate),
      parseInt((deadline.getTime() / 1000).toFixed(0)),
      { value: toWei(ethValue) }
    );
  }

  async exitAmmGivenAmountsOutAndEarlyRedeem(
    pool: PoolTestFixture,
    user: Signer,
    principals: Numberish,
    yields: Numberish,
    principalsLp: Numberish,
    yieldsLp: Numberish,
    toBackingToken: boolean,
    withApprovals: Boolean = false,
    deadline: Date = new Date(8640000000000000) /// default is 9/12/275760 (no deadline)
  ): Promise<Transaction> {
    const amm = pool.amm, t = pool.tempus;
    const value = await amm.balanceOf(user.address)

    if (withApprovals) {
      await amm.approve(user, this, value);
    }

    return this.connect(user).exitAmmGivenAmountsOutAndEarlyRedeem(
      amm.address,
      pool.tempus.address,
      withApprovals ? [] : [await constructPermit(amm, user, this, value, deadline)],
      t.principalShare.toBigNum(principals),
      t.yieldShare.toBigNum(yields),
      t.principalShare.toBigNum(principalsLp),
      t.yieldShare.toBigNum(yieldsLp),
      amm.toBigNum(value),
      toBackingToken
    );
  }

  async exitAmmGivenLpAndRedeem(
    pool:PoolTestFixture, 
    user: Signer, 
    lpTokens:Numberish, 
    principals:Numberish, 
    yields:Numberish, 
    toBacking: boolean,
    maxLeftoverShares: Numberish,
    withApprovals: Boolean = false,
    yieldsRate: Numberish = 1,
    maxSlippage: Numberish = 1,
    deadline: Date = new Date(8640000000000000) /// default is 9/12/275760 (no deadline)
  ): Promise<Transaction> {
    const amm = pool.amm, t = pool.tempus, addr = addressOf(user);

    if (withApprovals) {
      await amm.approve(user, this.address, lpTokens);
      await t.principalShare.approve(user, this.address, principals);
      await t.yieldShare.approve(user, this.address, yields);
    }

    return this.connect(user).exitAmmGivenLpAndRedeem(
      amm.address,
      pool.tempus.address,
      withApprovals 
        ? [] 
        : [
          await constructPermit(amm, user, this, lpTokens, deadline),
          await constructPermit(t.principalShare, user, this, principals, deadline),
          await constructPermit(t.yieldShare, user, this, yields, deadline)
        ],
      amm.toBigNum(lpTokens),
      amm.principalShare.toBigNum(principals),
      amm.yieldShare.toBigNum(yields),
      {
        minPrincipalsStaked: 0,
        minYieldsStaked: 0,
        maxLeftoverShares: t.principalShare.toBigNum(maxLeftoverShares),
        yieldsRate: amm.principalShare.toBigNum(yieldsRate),
        maxSlippage: toWei(maxSlippage)
      },
      toBacking,
      parseInt((deadline.getTime() / 1000).toFixed(0))
    );
  }
  
  async supportsInterface(interfaceId: string): Promise<Boolean> {
    return this.contract.supportsInterface(interfaceId);
  }
}
