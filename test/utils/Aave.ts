import { Contract } from "ethers";
import { NumberOrString, toWei, toRay, fromRay } from "./Decimal";
import { ContractBase, SignerOrAddress, addressOf } from "./ContractBase";
import { ERC20 } from "./ERC20";

export class Aave extends ContractBase {
  asset:ERC20;
  yieldToken:ERC20;
  
  constructor(pool:Contract, asset:ERC20, yieldToken:ERC20) {
    super("AavePoolMock", 18, pool);
    this.asset = asset;
    this.yieldToken = yieldToken;
  }

  /**
   * @param totalSupply Total DAI supply
   * @param initialRate Initial interest rate
   */
  static async create(totalSupply:Number, initialRate:Number = 1.0): Promise<Aave> {
    // using WEI, because DAI has 18 decimal places
    const asset = await ERC20.deploy("ERC20FixedSupply", "DAI Stablecoin", "DAI", toWei(totalSupply));
    const pool = await ContractBase.deployContract("AavePoolMock", asset.address);
    const yieldToken = await ERC20.attach("ATokenMock", await pool.yieldToken());
    const aave = new Aave(pool, asset, yieldToken);
    if (initialRate != 1.0) {
      await aave.setLiquidityIndex(initialRate);
    }
    return aave;
  }

  /**
   * @return Current Asset balance of the user as a decimal, eg. 1.0
   */
  async assetBalance(user:SignerOrAddress): Promise<NumberOrString> {
    return await this.asset.balanceOf(user);
  }

  /**
   * @return Yield Token balance of the user as a decimal, eg. 2.0
   */
  async yieldBalance(user:SignerOrAddress): Promise<NumberOrString> {
    let wei = await this.contract.getDeposit(addressOf(user));
    return this.fromBigNum(wei);
  }

  /**
   * @return Current liquidity index of AAVE pool in RAY, which is 
   *         almost equivalent to reserve normalized income.
   */
  async liquidityIndex(): Promise<NumberOrString> {
    return fromRay(await this.contract.getReserveNormalizedIncome(this.asset.address));
  }

  /**
   * Sets the AAVE pool's MOCK liquidity index in RAY
   */
  async setLiquidityIndex(liquidityIndex:NumberOrString, owner:SignerOrAddress = null) {
    if (owner !== null) {
      const prevLiquidityIndex = await this.liquidityIndex();
      const difference = (Number(liquidityIndex) / Number(prevLiquidityIndex)) - 1;
      if (difference > 0) {
        const totalSupply = await this.asset.balanceOf(this.yieldToken.address);
        const increaseBy = Number(totalSupply) * difference;
        await this.asset.transfer(owner, this.yieldToken.address, increaseBy);
      }
    }
    await this.contract.setLiquidityIndex(toRay(liquidityIndex));
  }

  /**
   * Approves and deposits funds from User into the AAVE Pool
   * @param user User who wants to deposit ETH into AAVE Pool
   * @param amount # of ETH to deposit, eg: 1.0
   */
  async deposit(user:SignerOrAddress, amount:NumberOrString) {
    await this.asset.approve(user, this.address, amount);
    await this.contract.connect(user).deposit(this.asset.address, this.toBigNum(amount), addressOf(user), 0);
  }
}
