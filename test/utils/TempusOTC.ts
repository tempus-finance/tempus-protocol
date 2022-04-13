import { Contract, Transaction } from "ethers";
import { NumberOrString, toWei } from "./Decimal";
import { ContractBase, SignerOrAddress, addressOf } from "./ContractBase";
import { PoolTestFixture } from "../pool-utils/PoolTestFixture";
import { TempusPool } from "./TempusPool";

export enum OfferStatus {
  NotSet,
  Created,
  Accepted
}

/**
 * Wrapper around TempusOTC
 */
export class TempusOTC extends ContractBase {
  tempusPool: TempusPool;

  constructor(contract:Contract, tempusPool: TempusPool) {
    super("TempusOTC", 18, contract);
    this.tempusPool = tempusPool;
  }

  static async create(tempusPool:TempusPool, nonce: number): Promise<TempusOTC> {
    return new TempusOTC(await ContractBase.deployContract("TempusOTC", tempusPool.address, {
      nonce: nonce
    }), tempusPool);
  }

  /** @return current status for offer */
  async offerStatus(): Promise<NumberOrString> {
    return this.contract.offerStatus();
  }

  /** @return how much principals offer setter sell */
  async principalSetOfferAmount(): Promise<NumberOrString> {
    const amount = await this.contract.principalSetOfferAmount();
    return this.tempusPool.principalShare.fromBigNum(amount);
  }

  /** @return requested yield amount that buyer should provide */
  async yieldRequestedAmount(): Promise<NumberOrString> {
    const amount = await this.contract.yieldRequestedAmount();
    return this.tempusPool.yieldShare.fromBigNum(amount);
  }

  /**
   * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
   * @param user The caller who is sending this approve
   * @param amount Amount of tokens to approve in contract decimals, eg 2.0 or "0.00001"
   * @param isBackingToken If true, @param amount is in BackingTokens, otherwise YieldBearingTokens
   */
  async approve(pool:PoolTestFixture, user:SignerOrAddress, amount:NumberOrString, isBackingToken:boolean) {
    const token = isBackingToken ? pool.asset : pool.ybt;
    await token.approve(user, this.address, amount);
  }
  
  /**
   * @dev Create offer
   * @param user The caller who is create offer (must be contract owner)
   * @param tokenAmount YBT/BT amount which will be deposited to get yield and principals
   * @param isBackingToken Specifies whether the deposited asset is the Yield Bearing Token or Backing Token
   * @param yieldRequestedAmount Amount in TYS which user that accepts an offer should provide
   * @param ethValue The value sent in Ether
   * @param recipient Address of the recipient who will receive TYS tokens (immediately and after offer accepted)
   */ 
  async setOffer(
    pool:PoolTestFixture, 
    user:SignerOrAddress,
    tokenAmount:NumberOrString, 
    isBackingToken:boolean, 
    yieldRequestedAmount:NumberOrString, 
    ethValue: NumberOrString = undefined,
    recipient: SignerOrAddress = user
  ): Promise<Transaction>{
    await this.approve(pool, user, tokenAmount, isBackingToken);
    const t = pool.tempus;
    const depositAmount = isBackingToken ? t.asset.toBigNum(tokenAmount) : t.yieldBearing.toBigNum(tokenAmount);
    const ethToTransfer = pool.acceptsEther ? ((ethValue == undefined) ? tokenAmount : ethValue) : (ethValue || 0);
    
    return this.connect(user).setOffer(
      depositAmount,
      isBackingToken,
      t.yieldShare.toBigNum(yieldRequestedAmount),
      addressOf(recipient),
      {value: toWei(ethToTransfer)}
    );
  }

  /**
   * @dev Cancel offer
   * @param user The caller who is cancel offer (must be same user that create offer and contract owner)
   * @param recipient Address of the recipient who will receive TPS tokens that are created in setOffer
   */ 
  async cancelOffer(
    user:SignerOrAddress, 
    recipient: SignerOrAddress = user
  ): Promise<Transaction>{
    return this.connect(user).cancelOffer(
      addressOf(recipient)
    );
  }

  /**
   * @dev Accept offer
   * @param user The caller who is accept offer
   * @param tokenAmount YBT/BT amount which will be deposited to get yield and principals
   * @param isBackingToken Specifies whether the deposited asset is the Yield Bearing Token or Backing Token
   * @param ethValue The value sent in Ether
   * @param recipient Address of the recipient who will receive TPS and TYS
   */ 
  async acceptOffer(
    pool:PoolTestFixture, 
    user:SignerOrAddress, 
    tokenAmount:NumberOrString, 
    isBackingToken:boolean, 
    ethValue: NumberOrString = undefined,
    recipient: SignerOrAddress = user
  ): Promise<Transaction>{
    await this.approve(pool, user, tokenAmount, isBackingToken);
    const t = pool.tempus;
    const depositAmount = isBackingToken ? t.asset.toBigNum(tokenAmount) : t.yieldBearing.toBigNum(tokenAmount);
    const ethToTransfer = pool.acceptsEther ? ((ethValue == undefined) ? tokenAmount : ethValue) : (ethValue || 0);
    
    return this.connect(user).acceptOffer(
      depositAmount, 
      isBackingToken,
      addressOf(recipient),
      {value: toWei(ethToTransfer)}
    );
  }

  /**
   * @dev Withdraw TYS (Tempus Yield Shares) after offer accepted
   * @param user The caller who is accept offer
   * @param tokenAmount TYS amount which is withdraw
   */ 
  async withdrawYieldAfterOfferAccepted(
    pool:PoolTestFixture,
    user:SignerOrAddress,
    tokenAmount:NumberOrString
  ): Promise<Transaction>{
    const t = pool.tempus;
    return this.connect(user).withdrawYieldAfterOfferAccepted(
      t.yieldShare.toBigNum(tokenAmount)
    );
  }

  /**
   * @dev Redeem TPS+TYS held by msg.sender into Backing Tokens or Yield Bearing Tokens
   * @param sender The caller who is redeem
   * @param principals Amount of Tempus Principals to redeem in PrincipalShare decimal precision
   * @param yields Amount of Tempus Yields to redeem in YieldShare decimal precision
   * @param isBackingToken Specifies whether the reedem asset will be in Backing Token or Yield Bearing Token
   * @param recipient Address of user that will receive BT/YBT
   */
  async redeem(
    pool:PoolTestFixture,
    sender:SignerOrAddress,
    principals:NumberOrString,
    yields:NumberOrString,
    isBackingToken:boolean,
    recipient:SignerOrAddress = sender
  ): Promise<Transaction>{
    const t = pool.tempus;
    return this.connect(sender).redeem(
      t.principalShare.toBigNum(principals),
      t.yieldShare.toBigNum(yields),
      addressOf(recipient),
      isBackingToken
    );
  }
}