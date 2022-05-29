import { expect } from "chai";
import { Transaction } from "ethers";
import { deployments, ethers } from "hardhat";
import { ContractBase, Signer, SignerOrAddress } from "@tempus-sdk/utils/ContractBase";
import { TempusPool, PoolType, TempusSharesNames, generateTempusSharesNames } from "@tempus-sdk/tempus/TempusPool";
import { blockTimestamp, setEvmTime, setNextBlockTimestamp } from "@tempus-sdk/utils/Utils";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { IERC20 } from "@tempus-sdk/utils/IERC20";
import { Numberish } from "@tempus-sdk/utils/DecimalUtils";
import { getRevertMessage } from "@tempus-sdk/utils/Utils";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { TempusPoolAMM } from "@tempus-sdk/tempus/TempusPoolAMM";
import { PoolShare } from "@tempus-sdk/tempus/PoolShare";
import { strict as assert } from 'assert';

const ROUNDING_ERROR_TOLERANCE_THRESHOLD = 0.00000001; /// allow for 0.000001% error in YBT amounts 
export interface BalancesExpectation {
  tps:number; // expected TPS balance
  tys:number; // etc.
  ybt:number;
}

export interface WalletExpectation {
  pegged:BalancesExpectation; // expectation for pegged YBT-s
  unpegged:BalancesExpectation;
}

export interface YBTDepositExpectation extends WalletExpectation {
  ybtAmount:number;
}

export interface BTDepositExpectation extends WalletExpectation {
  btAmount:number;
}

export interface RedeemShareAmounts {
  tps:number; // amount of TPS to redeem
  tys:number; 
}

export interface RedeemAmounts {
  pegged:RedeemShareAmounts;
  unpegged:RedeemShareAmounts;
}

export interface RedeemExpectation extends WalletExpectation {
  amount:RedeemShareAmounts|RedeemAmounts;
}

function instanceOfRedeemAmounts(object: any): object is RedeemAmounts {
  return 'pegged' in object;
}

function getRedeemShareAmounts(pegged:boolean, expects:RedeemExpectation): RedeemShareAmounts {
  if (instanceOfRedeemAmounts(expects.amount))
    return pegged ? expects.amount.pegged : expects.amount.unpegged;
  return expects.amount;
}

export class UserState {
  principalShares:Number;
  yieldShares:Number;
  yieldBearing:Number;
  yieldPeggedToAsset:boolean;

  public expectMulti(principalShares:number, yieldShares:number, yieldBearingPegged:number, yieldBearingVariable:number, message:string = null) {
    const yieldBearing = this.yieldPeggedToAsset ? yieldBearingPegged : yieldBearingVariable;
    this.expect(principalShares, yieldShares, yieldBearing, message);
  }

  public expect(principalShares:number, yieldShares:number, yieldBearing:number, message:string = null) {
    const msg = (message||"") + " expected " + (this.yieldPeggedToAsset ? "pegged" : "unpegged")
              + " balances TPS="+principalShares
              + " TYS="+yieldShares
              + " YBT="+yieldBearing;
    expect(this.principalShares).to.equal(principalShares, msg+" but TPS did not match");
    expect(this.yieldShares).to.equal(yieldShares, msg+" but TYS did not match");
    
    /// tolerate small rounding errors
    expect(this.yieldBearing).to.be.within(
      yieldBearing * (1 - ROUNDING_ERROR_TOLERANCE_THRESHOLD),
      yieldBearing * (1 + ROUNDING_ERROR_TOLERANCE_THRESHOLD),
      "yieldBearing did not match expected value"+msg
    );
  }
}

// Stores all required state for a unique ITestPool fixture
export class FixtureState {
  maturityTime:number; // UNIX timestamp in milliseconds
  names:TempusSharesNames;
  getInitialContractState:(options?: any)=>Promise<any>;
  constructor(maturityTime:number, names:TempusSharesNames, getState:(options?: any)=>Promise<any>) {
    this.maturityTime = maturityTime;
    this.names = names;
    this.getInitialContractState = getState;
  }
}

export interface TempusParams {
  initialRate:number; // Initial interest rate
  poolDuration:number; // Pool lifetime duration in seconds
  yieldEst:number; // Estimated initial yield of the pool
}

export interface TempusAMMParams {
  initialRate:number; // Initial interest rate
  poolDuration:number; // Pool lifetime duration in seconds
  yieldEst:number; // Estimated initial yield of the pool
  ammSwapFee:number; // Swap fee percentage for TempusAMM
  ammAmplifyStart:number; // Amplification start value for TempusAMM
  ammAmplifyEnd:number; // Amplification end value for TempusAMM
}

// When we create TestPool fixtures with different parameters,
// each parameter set is kept separately here
const POOL_FIXTURES: { [signature: string]: FixtureState } = {};

export abstract class PoolTestFixture {
  type:PoolType;

  // True if the pool accepts/requires Ether on deposits
  acceptsEther:boolean;

  // if true, underlying pool pegs YieldToken 1:1 to BackingToken
  // ex true: deposit(100) with rate 1.0 will yield 100 TPS and TYS
  // ex false: deposit(100) with rate 1.2 will yield 120 TPS and TYS
  yieldPeggedToAsset:boolean;

  // is this an integration test fixture?
  integration:boolean;

  // initialized by initPool()
  tempus:TempusPool;
  controller:TempusController;
  amm:TempusPoolAMM;
  signers:Signer[];

  // common state reset when a fixture is instantiated
  initialRate:number; // initial interest rate
  yieldEst:number; // initial estimated yield
  maturityTime:number; // UNIX timestamp in milliseconds
  poolDuration:number; // pool duration in seconds
  names:TempusSharesNames;

  /** The underlying pool contract, such as Aave, Lido or Comptroller */
  pool:ContractBase;

  /** The BackingToken of the underlying pool */
  asset:IERC20;

  /** The YieldBearingToken of the underlying pool */
  ybt:ERC20;

  /** Tempus Principal Share */
  principals:PoolShare;

  /** Tempus Yield Share */
  yields:PoolShare; 

  constructor(type:PoolType, acceptsEther:boolean, yieldPeggedToAsset:boolean, integration:boolean) {
    this.type = type;
    this.acceptsEther = acceptsEther;
    this.yieldPeggedToAsset = yieldPeggedToAsset;
    this.integration = integration;
  }

  /**
   * This will create TempusPool, TempusAMM and TempusController instances.
   * @param params Parameters for Pool, AMM and 
   */
  abstract createWithAMM(params:TempusAMMParams): Promise<TempusPool>;

  /**
   * Simplified overload for createPoolWithAMM, giving default parameters for AMM
   */
  public create(params:TempusParams): Promise<TempusPool> {
    return this.createWithAMM({ ...params, ammSwapFee:0.02, ammAmplifyStart:5, ammAmplifyEnd:5 });
  }

  /**
   * Super-simplified overload for create, sets default parameters
   */
  public createDefault(): Promise<TempusPool> {
    return this.create({ initialRate:1.0, poolDuration:60*60, yieldEst:0.1 });
  }

  /**
   * @param rate Sets the Interest Rate for the underlying mock pool
   */
  abstract setInterestRate(rate:number): Promise<void>;

  /**
   * Sets force fail on next deposit or redeem call
   */
  abstract forceFailNextDepositOrRedeem(): Promise<void>;

  /**
   * Deposit BackingTokens into the UNDERLYING pool and receive YBT
   */
  abstract deposit(user:Signer, amount:number): Promise<void>;

  /**
   * Gets the owner and users for testing
   */
   async getSigners(): Promise<Signer[]> {
    return ethers.getSigners();
  }

  /**
   * Deposit YieldBearingTokens into TempusPool
   */
  async depositYBT(user:Signer, yieldBearingAmount:Numberish, recipient:SignerOrAddress = user): Promise<Transaction> {
    return this.tempus.controller.depositYieldBearing(user, this.tempus, yieldBearingAmount, recipient);
  }

  /**
   * Deposit BackingTokens into TempusPool
   */
  async depositBT(user:Signer, backingTokenAmount:Numberish, recipient:SignerOrAddress = user, ethValue: Numberish = undefined): Promise<Transaction> {
    const ethToTransfer = this.acceptsEther ? ((ethValue == undefined) ? backingTokenAmount : ethValue) : (ethValue || 0);
    return this.tempus.controller.depositBacking(user, this.tempus, backingTokenAmount, recipient, ethToTransfer);
  }

  /**
   * Redeems TempusShares to YieldBearingTokens
   */
  async redeemToYBT(user:Signer, principalAmount:Numberish, yieldAmount:Numberish, recipient:SignerOrAddress = user): Promise<Transaction> {
    return this.tempus.controller.redeemToYieldBearing(user, this.tempus, principalAmount, yieldAmount, recipient);
  }

  /**
   * Redeems TempusShares to BackingTokens
   */
  async redeemToBT(user:Signer, principalAmount:Numberish, yieldAmount:Numberish, recipient:SignerOrAddress = user): Promise<Transaction> {
    return this.tempus.controller.redeemToBacking(user, this.tempus, principalAmount, yieldAmount, recipient);
  }

  /**
   * Deposit YieldBearingTokens into TempusPool, and return a testable `expect()` object.
   * This is set up so we are able to report TEST failure File and Line:
   * @example (await pool.expectDepositYBT(user, 100)).to.equal('success');
   * @returns RevertMessage assertion, or 'success' assertion
   */
  async expectDepositYBT(user:Signer, yieldBearingAmount:Numberish, recipient:SignerOrAddress = user): Promise<Chai.Assertion> {
    try {
      await this.depositYBT(user, yieldBearingAmount, recipient);
      return expect('success');
    } catch(e) {
      return expect(getRevertMessage(e));
    }
  }

  /**
   * Deposit BackingTokens into TempusPool, and return a testable `expect()` object.
   * This is set up so we are able to report TEST failure File and Line:
   * @example (await pool.expectDepositBT(user, 100)).to.equal('success');
   * @returns RevertMessage assertion, or 'success' assertion
   */
  async expectDepositBT(user:Signer, backingTokenAmount:Numberish, recipient:SignerOrAddress = user, ethValue: Numberish = undefined): Promise<Chai.Assertion> {
    try {
      await this.depositBT(user, backingTokenAmount, recipient, ethValue);
      return expect('success');
    } catch(e) {
      return expect(getRevertMessage(e));
    }
  }

  /**
   * Redeem YieldBearingTokens from TempusPool, and return a testable `expect()` object.
   * This is set up so we are able to report TEST failure File and Line:
   * @example (await pool.expectRedeemYBT(user, 100, 100)).to.equal('success');
   * @returns RevertMessage assertion, or 'success' assertion
   */
  async expectRedeemYBT(user:Signer, principalShares:Numberish, yieldShares:Numberish, recipient:SignerOrAddress = user): Promise<Chai.Assertion> {
    try {
      await this.redeemToYBT(user, principalShares, yieldShares, recipient);
      return expect('success');
    } catch(e) {
      return expect(getRevertMessage(e));
    }
  }

  /**
   * Redeem BackingTokens from TempusPool, and return a testable `expect()` object.
   * This is set up so we are able to report TEST failure File and Line:
   * @example (await pool.expectRedeemYBT(user, 100, 100)).to.equal('success');
   * @returns RevertMessage assertion, or 'success' assertion
   */
  async expectRedeemBT(user:Signer, principalShares:Numberish, yieldShares:Numberish, recipient:SignerOrAddress = user): Promise<Chai.Assertion> {
    try {
      await this.redeemToBT(user, principalShares, yieldShares, recipient);
      return expect('success');
    } catch(e) {
      return expect(getRevertMessage(e));
    }
  }

  /**
   * Finalize the pool after maturity
   */
  async finalize(): Promise<void> {
    return this.tempus.finalize();
  }

  /**
   * Fast forwards time to after maturity and Finalized the pool
   */
  async fastForwardToMaturity(): Promise<void> {
    await setEvmTime(this.maturityTime + 1);
    await this.finalize();
  }

  /**
   * Fast forwards time to certain point in time
   */
  async setTimeDaysAfterPoolStart(days: number): Promise<void> {
    assert.ok(days > 0);
    const startTime:number = +await this.tempus.startTime();
    const desiredTime:number = startTime + (days * 24*60*60);
    await setEvmTime(desiredTime);
  }

  /**
   * Fast forwards time to certain point in time
   */
  async setTimeRelativeToPoolStart(percentDuration: number): Promise<void> {
    assert.ok(percentDuration >= 0.0 && percentDuration <= 1.0);
    const startTime:number = +await this.tempus.startTime();
    const duration:number = +await this.tempus.maturityTime() - startTime;
    await setEvmTime(startTime + percentDuration * duration);
  }

  /**
   * Sets the next block timestamp relative to the pool's duration (without mining a block)
   */
  async setNextBlockTimestampRelativeToPoolStart(percentDuration: number): Promise<void> {
    assert.ok(percentDuration >= 0.0 && percentDuration <= 1.0);
    const startTime:number = +await this.tempus.startTime();
    const duration:number = +await this.tempus.maturityTime() - startTime;
    await setNextBlockTimestamp(startTime + percentDuration * duration);
  }

  /**
   * Typical setup call for most tests
   * 1. Deposits Asset into underlying pool by Owner
   * 1. Transfers Assets from Owner to depositors[]
   * 2. Transfers YBT from Owner to depositors[]
   */
  async setupAccounts(owner:Signer, depositors:[Signer,number][]): Promise<void> {
    if (!this.tempus)
      throw new Error('setupAccounts: createPool() not called');
    
    const totalDeposit = depositors.reduce((sum, current) => sum + current[1], 100);
    await this.deposit(owner, totalDeposit);

    for (let depositor of depositors) { // initial deposit for users
      const user = depositor[0];
      const amount = depositor[1];
      await this.asset.transfer(owner, user, 100000);
      await this.ybt.transfer(owner, user, amount);
    }
  }

  /**
   * @returns Balances state for a single user
   */
  async userState(user:Signer): Promise<UserState> {
    let state = new UserState();
    state.principalShares = (await this.principals.balanceOf(user)).toNumber();
    state.yieldShares = (await this.yields.balanceOf(user)).toNumber();
    state.yieldBearing = (await this.ybt.balanceOf(user)).toNumber();
    state.yieldPeggedToAsset = this.yieldPeggedToAsset;
    return state;
  }

  /**
   * TESTING UTILITY: checks user state for TPS+TYS balance and YBT balance
   * @param user User whose wallet to check
   * @param expects All balance check parameters
   * @param message Description of what we expected to happen
   */
  async checkBalance(user:Signer, expects:BalancesExpectation, message?:string): Promise<void> {
    (await this.userState(user)).expect(expects.tps, expects.tys, expects.ybt, message);
  }

  /**
   * TESTING UTILITY: checks user state for TPS+TYS balance and YBT balance
   * @param user User whose wallet to check
   * @param wallet All wallet check parameters
   * @param message Description of what we expected to happen
   */
  async checkWallet(user:Signer, wallet:WalletExpectation, message?:string): Promise<void> {
    return this.checkBalance(user, this.yieldPeggedToAsset ? wallet.pegged : wallet.unpegged, message);
  }

  /**
   * TESTING UTILITY: does a depositYBT and then validates user wallet balances
   * @param user User who is depositing and receiving shares
   * @param expects All the deposit and checks parameters
   * @param message Description of what we expected to happen
   */
  async depositAndCheck(user:Signer, expects:YBTDepositExpectation, message?:string): Promise<void> {
    await this.depositYBT(user, expects.ybtAmount);
    await this.checkWallet(user, expects, message);
  }

  /**
   * TESTING UTILITY: does a depositBT and then validates user wallet balances
   * @param user User who is depositing and receiving shares
   * @param expects All the deposit and checks parameters
   * @param message Description of what we expected to happen
   */
  async depositAndCheckBT(user:Signer, expects:BTDepositExpectation, message?:string): Promise<void> {
    await this.depositBT(user, expects.btAmount);
    await this.checkWallet(user, expects, message);
  }

  /**
   * TESTING UTILITY: does a redeemToYBT and then validates user wallet balances
   * @param user User who is redeeming shares and receiving tokens
   * @param expects All the redemption and checks parameters
   * @param message Description of what we expected to happen
   */
  async redeemAndCheck(user:Signer, expects:RedeemExpectation, message?:string): Promise<void> {
    const amount:RedeemShareAmounts = getRedeemShareAmounts(this.yieldPeggedToAsset, expects);
    await this.redeemToYBT(user, amount.tps, amount.tys);
    await this.checkWallet(user, expects, message);
  }

  /**
   * TESTING UTILITY: does a redeemToBT and then validates user wallet balances
   * @param user User who is redeeming shares and receiving tokens
   * @param expects All the redemption and checks parameters
   * @param message Description of what we expected to happen
   */
  async redeemAndCheckBT(user:Signer, expects:RedeemExpectation, message?:string): Promise<void> {
    const amount:RedeemShareAmounts = getRedeemShareAmounts(this.yieldPeggedToAsset, expects);
    await this.redeemToBT(user, amount.tps, amount.tys);
    await this.checkWallet(user, expects, message);
  }

  protected async initPool(
    p:TempusAMMParams,
    ybtName:string,
    ybtSymbol:string,
    newPool:()=>Promise<ContractBase>,
    setPool:(pool:ContractBase)=>void
  ): Promise<TempusPool> {
    this.initialRate = p.initialRate;
    this.poolDuration = p.poolDuration;
    this.yieldEst = p.yieldEst;

    const sig = [this.type, ybtSymbol, p.initialRate, p.poolDuration,
                 p.yieldEst, p.ammSwapFee, p.ammAmplifyStart, p.ammAmplifyEnd].join("|");
    
    let f:FixtureState = POOL_FIXTURES[sig];
    if (!f) // initialize a new fixture
    {
      const controller = await TempusController.instance();
      const maturityTime = await blockTimestamp() + this.poolDuration;
      const names = generateTempusSharesNames(ybtName, ybtSymbol, maturityTime);
      f = new FixtureState(maturityTime, names, deployments.createFixture(async () =>
      {
        await deployments.fixture(undefined, { keepExistingDeployments: true, });
        // Note: for fixtures, all contracts must be initialized inside this callback
        const [owner, ...users] = await this.getSigners();
        const pool = await newPool(); // calls Aave.create
        const asset = (pool as any).asset;
        const ybt = (pool as any).yieldToken;

        // initialize new tempus pool with the controller, TempusPool is auto-registered
        const tempus = await TempusPool.deploy(
          this.type, owner, controller, asset, ybt, maturityTime, p.yieldEst, names, pool.address
        );

        // new AMM instance and register the AMM with the controller
        const amm = await TempusPoolAMM.create(owner, controller, tempus.principalShare, tempus.yieldShare, 
          p.ammAmplifyStart, p.ammAmplifyEnd, maturityTime, p.ammSwapFee
        );

        return {
          signers: { owner, users },
          contracts: { pool:pool, tempus:tempus, amm: amm },
        };
      }));
      POOL_FIXTURES[sig] = f; // save for later use
    }

    // always restore pool from fixture (that's just the way the fixture approach works bro)
    const s = await f.getInitialContractState();
    this.maturityTime = f.maturityTime;
    this.names = f.names;
    this.signers = [s.signers.owner, ...s.signers.users];

    this.pool = s.contracts.pool;
    setPool(this.pool);
    this.tempus = s.contracts.tempus;
    this.controller = this.tempus.controller;
    this.amm = s.contracts.amm;
    this.principals = this.tempus.principalShare;
    this.yields = this.tempus.yieldShare;
    return this.tempus;
  }
}
