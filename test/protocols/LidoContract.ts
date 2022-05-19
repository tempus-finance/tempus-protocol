import { ethers } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { Decimal } from "../utils/Decimal";
import { Numberish, parseDecimal } from "../utils/DecimalUtils";
import { SignerOrAddress, Signer, addressOf } from "../utils/ContractBase";
import { ERC20 } from "../utils/ERC20";
import { ERC20Ether } from "../utils/ERC20Ether";

export abstract class LidoContract extends ERC20 {
  asset:ERC20Ether; // ERC20 Ether Wrapper (not WETH!)
  yieldToken:ERC20; // StETH

  constructor(contractName:string, pool:Contract, asset:ERC20Ether) {
    super(contractName, asset.decimals, pool);
    this.asset = asset;
    this.yieldToken = this; // for Lido, the pool itself is the Yield Token
  }

  /** @return stETH balance of an user */
  async sharesOf(user:SignerOrAddress): Promise<Decimal> {
    return this.toDecimal(await this.contract.sharesOf(addressOf(user)));
  }

  /** @return total stETH shares minted */
  async getTotalShares(): Promise<Decimal> {
    return this.toDecimal(await this.contract.getTotalShares());
  }

  /** @return the amount of Ether that corresponds to `_sharesAmount` token shares. */
  async getPooledEthByShares(sharesAmount:Numberish): Promise<Decimal> {
    return this.toDecimal(await this.contract.getPooledEthByShares(this.toBigNum(sharesAmount)));
  }

  /** @return the amount of shares that corresponds to `_ethAmount` protocol-controlled Ether. */
  async getSharesByPooledEth(_ethAmount:Numberish): Promise<Decimal> {
    return this.toDecimal(await this.contract.getSharesByPooledEth(this.toBigNum(_ethAmount)));
  }

  /** @return total pooled ETH: beaconBalance + bufferedEther */
  async totalSupply(): Promise<Decimal> {
    return this.toDecimal(await this.contract.totalSupply());
  }

  // Interest rate as 1e18 BigNumber
  async interestRateBigNum(): Promise<BigNumber> {
    // using higher sharesAmount for increased precision
    const byShares = parseDecimal("1000000.0", 18);
    const shares:BigNumber = await this.contract.getPooledEthByShares(byShares);
    return shares.div(BigNumber.from(1000000)); // convert to 1e18
  }

  /** @return Stored Interest Rate */
  async interestRate(): Promise<Decimal> {
    return this.toDecimal(await this.interestRateBigNum());
  }

  /**
   * Sets the pool Interest Rate
   * @param interestRate New synthetic Interest Rate
   */
  abstract setInterestRate(interestRate:Numberish): Promise<void>;

  async submit(signer:SignerOrAddress, amount:Numberish): Promise<Numberish> {
    const val = this.toBigNum(amount); // payable call, set value:
    return await this.connect(signer).submit(addressOf(signer), {value: val})
  }

  async depositBufferedEther(): Promise<void> {
    // ethers.js does not resolve overloads, so need to call the function by string lookup
    await this.contract["depositBufferedEther()"]();
  }

  async depositBufferedEther2(maxDeposits:number): Promise<void> {
    await this.contract["depositBufferedEther(uint256)"](maxDeposits);
  }

  /**
   * Updates the contract with information from ETH2 orcale
   * Calculates rewards using formulae:  rewards = balance - 32*validators
   * @param validators Total number of ACTUAL 32xETH deposits made during deposit event.
   *                   This could be different than # of depositBufferedEther(1) calls.
   * @param balance Actual balance in the ETH2 oracle
   */
  async pushBeacon(owner:Signer, validators:number, balance:number): Promise<void> {
    await this.connect(owner).pushBeacon(validators, this.toBigNum(balance));
  }

  // pushes balance to achieve certain amount of `totalRewards`
  async pushBeaconRewards(owner:Signer, validators:number, rewards:number): Promise<void> {
    // push X eth reward, rewards = balance - 32*validators
    const balance = rewards + 32*validators;
    await this.pushBeacon(owner, validators, balance);
  }

  async withdraw(signer:Signer, shareAmount:Number): Promise<void> {
    // We ignore the pubKeyHash.
    const hash = ethers.utils.formatBytes32String("");
    await this.connect(signer).withdraw(this.toBigNum(shareAmount), hash);
  }

  async printState(title: string, owner: string, user: string): Promise<void> {
    console.log("State:", title);
    console.log("  totalSupply:", await this.totalSupply());
    console.log("  totalShares:", await this.getTotalShares());
    console.log("  owner.shares: ", await this.sharesOf(owner));
    console.log("  owner.balance:", await this.balanceOf(owner));
    console.log("  user.shares: ", await this.sharesOf(user));
    console.log("  user.balance:", await this.balanceOf(user));
  }
}
