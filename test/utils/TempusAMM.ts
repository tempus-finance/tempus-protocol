import { ethers } from "hardhat";
import { Contract, Transaction } from "ethers";
import { NumberOrString, toWei, fromWei } from "./Decimal";
import { ContractBase } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { MockProvider } from "@ethereum-waffle/provider";
import { deployMockContract } from "@ethereum-waffle/mock-contract";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";

const WETH_ARTIFACTS = require("../../artifacts/@balancer-labs/v2-solidity-utils/contracts/misc/IWETH.sol/IWETH");

export const SECOND = 1;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;
export const WEEK = DAY * 7;
export const MONTH = DAY * 30;

export class TempusAMM extends ContractBase {
  vault: Contract;
  principalShare: ERC20;
  yieldShare: ERC20;

  constructor(tempusAmmPool: Contract, vault: Contract, principalShare: ERC20, yieldShare: ERC20) {
    super("TempusAMM", 18, tempusAmmPool);
    this.vault = vault;
    this.principalShare = principalShare;
    this.yieldShare = yieldShare;
  }

  static async create(
    owner: SignerWithAddress,
    amplification: Number,
    swapFeePercentage: Number, 
    principalShare: ERC20,
    yieldShare:ERC20
  ): Promise<TempusAMM> {
    const [sender] = new MockProvider().getWallets();
    const mockedWETH = await deployMockContract(sender, WETH_ARTIFACTS.abi);

    const authorizer = await ContractBase.deployContract("Authorizer", owner.address);
    const vault = await ContractBase.deployContract("Vault", authorizer.address, mockedWETH.address, 3 * MONTH, MONTH);

    let tempusAMM = await ContractBase.deployContract(
      "TempusAMM", 
      vault.address, 
      "Tempus LP token", 
      "LP", 
      [principalShare.address, yieldShare.address].sort((a1, a2) => parseInt(a1) - parseInt(a2)),
      amplification, 
      toWei(swapFeePercentage),
      3 * MONTH, 
      MONTH, 
      owner.address
    );

    return new TempusAMM(tempusAMM, vault, principalShare, yieldShare);
  }

  async balanceOf(user:SignerWithAddress): Promise<NumberOrString> {
    return fromWei(await this.contract.balanceOf(user.address));
  }

  async provideLiquidity(from: SignerWithAddress, principalShareBalance: Number, yieldShareBalance: Number, initial: boolean):Promise<Transaction> {
    const principalBalance = toWei(principalShareBalance);
    const yieldBalance = toWei(yieldShareBalance);
    await this.principalShare.connect(from).approve(this.vault.address, principalBalance);
    await this.yieldShare.connect(from).approve(this.vault.address, yieldBalance);
    
    const JOIN_KIND = initial ? 0 : 1;
    const poolId = await this.contract.getPoolId();
    const assets = [
      { address: this.principalShare.address, amount: principalBalance },
      { address: this.yieldShare.address, amount: yieldBalance }
    ].sort(( asset1, asset2 ) => parseInt(asset1.address) - parseInt(asset2.address));
    
    const initialBalances = assets.map(({ amount }) => amount);
    const initUserData = ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]'], [JOIN_KIND, initialBalances]
    );
    const joinPoolRequest = {
      assets: assets.map(({ address }) => address),
      maxAmountsIn: initialBalances,
      userData: initUserData,
      fromInternalBalance: false
    };
  
    return this.vault.connect(from).joinPool(poolId, from.address, from.address, joinPoolRequest);
  }

  async swapGivenIn(from: SignerWithAddress, assetIn: string, assetOut: string, amount: Number): Promise<Transaction> {
    this.yieldShare.connect(from).approve(this.vault.address, toWei(amount));
    this.principalShare.connect(from).approve(this.vault.address, toWei(amount));
    const SWAP_KIND_GIVEN_IN = 0;
    const poolId = await this.contract.getPoolId();
    
    const singleSwap = {
      poolId,
      kind: SWAP_KIND_GIVEN_IN,
      assetIn: assetIn,
      assetOut: assetOut,
      amount: toWei(amount),
      userData: 0x0
    };
  
    const fundManagement = {
      sender: from.address,
      fromInternalBalance: false,
      recipient: from.address,
      toInternalBalance: false
    };
    const minimumReturn = 1;
    const deadline = Math.floor(new Date().getTime() / 1000) * 2; // current_unix_timestamp * 2
    return this.vault.connect(from).swap(singleSwap, fundManagement, minimumReturn, deadline);
  }

  async swapGivenOut(from: SignerWithAddress, assetIn: string, assetOut: string, amount: Number): Promise<Transaction> {
    this.yieldShare.connect(from).approve(this.vault.address, toWei(amount));
    this.principalShare.connect(from).approve(this.vault.address, toWei(amount));
    
    const SWAP_KIND_GIVEN_OUT = 1;
    const poolId = await this.contract.getPoolId();
    
    const singleSwap = {
      poolId,
      kind: SWAP_KIND_GIVEN_OUT,
      assetIn: assetIn,
      assetOut: assetOut,
      amount: toWei(amount),
      userData: 0x0
    };
  
    const fundManagement = {
      sender: from.address,
      fromInternalBalance: false,
      recipient: from.address,
      toInternalBalance: false
    };
    const maximumIn = toWei(1000);
    const deadline = Math.floor(new Date().getTime() / 1000) * 2; // current_unix_timestamp * 2
    return this.vault.connect(from).swap(singleSwap, fundManagement, maximumIn, deadline);
  }
}
