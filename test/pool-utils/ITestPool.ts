import { expect } from "chai";
import { Transaction } from "ethers";
import { ethers, deployments } from "hardhat";
import { Signer, SignerOrAddress } from "../utils/ContractBase";
import { TempusPool, PoolType, TempusSharesNames, generateTempusSharesNames } from "../utils/TempusPool";
import { blockTimestamp, setEvmTime } from "../utils/Utils";
import { ERC20 } from "../utils/ERC20";
import { PoolShare } from "../utils/PoolShare";
import { NumberOrString } from "../utils/Decimal";
import { getRevertMessage } from "../utils/Utils";

export class UserState {
  principalShares:Number;
  yieldShares:Number;
  yieldBearing:Number;

  // non-async to give us actual test failure line #
  public expect(principalShares:number, yieldShares:number, yieldBearing:number, message:string = null) {
    const msg = message === null ? "" : ": expected" + message;
    expect(this.principalShares).to.equal(principalShares, "principalShares did not match expected value"+msg);
    expect(this.yieldShares).to.equal(yieldShares, "yieldShares did not match expected value"+msg);
    expect(this.yieldBearing).to.equal(yieldBearing, "yieldBearing did not match expected value"+msg);
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

// When we create TestPool fixtures with different parameters,
// each parameter set is kept separately here
const POOL_FIXTURES: { [signature: string]: FixtureState } = {};

export abstract class ITestPool {
  type:PoolType;

  // if true, underlying pool pegs YieldToken 1:1 to BackingToken
  // ex true: deposit(100) with rate 1.0 will yield 100 TPS and TYS
  // ex false: deposit(100) with rate 1.2 will yield 120 TPS and TYS
  yieldPeggedToAsset:boolean;

  // initialized by createTempusPool()
  tempus:TempusPool;
  signers:Signer[];

  // common state reset when a fixture is instantiated
  initialRate:number; // initial interest rate
  yieldEst:number; // initial estimated yield
  maturityTime:number; // UNIX timestamp in milliseconds
  poolDuration:number; // pool duration in seconds
  names:TempusSharesNames;

  constructor(type:PoolType, yieldPeggedToAsset:boolean) { 
    this.type = type;
    this.yieldPeggedToAsset = yieldPeggedToAsset;
  }

  /**
   * @return The underlying asset token of the backing pool
   */
  abstract asset(): ERC20;

  /**
   * @return The yield token of the backing tool
   */
  abstract yieldToken(): ERC20;

  /**
   * @return Current Yield Bearing Token balance of the user
   */
  abstract yieldTokenBalance(user:SignerOrAddress): Promise<NumberOrString>;

  /**
   * This must create the TempusPool instance
   */
  abstract createTempusPool(initialRate:number, poolDurationSeconds:number, yieldEst:number): Promise<TempusPool>;

  /**
   * @param rate Sets the Interest Rate for the underlying mock pool
   */
  abstract setInterestRate(rate:number): Promise<void>;

  /**
   * Deposit BackingTokens into the UNDERLYING pool and receive YBT
   */
  abstract deposit(user:Signer, amount:number): Promise<void>;

  /**
   * Deposit YieldBearingTokens into TempusPool
   */
  async depositYBT(user:Signer, yieldBearingAmount:number, recipient:Signer = user): Promise<Transaction> {
    return this.tempus.deposit(user, yieldBearingAmount, recipient);
  }

  /**
   * Deposit BackingTokens into TempusPool
   */
   async depositBT(user:Signer, backingTokenAmount:number, recipient:Signer = user): Promise<Transaction> {
    return this.tempus.depositBackingToken(user, backingTokenAmount, recipient);
  }

  /**
   * Redeems TempusShares to YieldBearingTokens
   */
   async redeemToYBT(user:Signer, principalShares:number, yieldShares:number): Promise<Transaction> {
    return this.tempus.redeem(user, principalShares, yieldShares);
  }

  /**
   * Redeems TempusShares to BackingTokens
   */
   async redeemToBT(user:Signer, principalAmount:number, yieldAmount:number): Promise<Transaction> {
    return this.tempus.redeemToBackingToken(user, principalAmount, yieldAmount);
  }

  /**
   * @return Current Backing Token balance of the user
   */
   async backingTokenBalance(user:Signer): Promise<NumberOrString> {
    return this.asset().balanceOf(user);
  }

  /**
   * Deposit YieldBearingTokens into TempusPool, and return a testable `expect()` object.
   * This is set up so we are able to report TEST failure File and Line:
   * @example (await pool.expectDepositYBT(user, 100)).to.equal('success');
   * @returns RevertMessage assertion, or 'success' assertion
   */
  async expectDepositYBT(user:Signer, yieldBearingAmount:number, recipient:Signer = user): Promise<Chai.Assertion> {
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
  async expectDepositBT(user:Signer, backingTokenAmount:number, recipient:Signer = user): Promise<Chai.Assertion> {
    try {
      await this.depositBT(user, backingTokenAmount, recipient);
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
   async expectRedeemYBT(user:Signer, principalShares:number, yieldShares:number): Promise<Chai.Assertion> {
    try {
      await this.redeemToYBT(user, principalShares, yieldShares);
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
   async expectRedeemBT(user:Signer, principalShares:number, yieldShares:number): Promise<Chai.Assertion> {
    try {
      await this.redeemToBT(user, principalShares, yieldShares);
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
    return this.tempus.finalize();
  }

  /**
   * Typical setup call for most tests
   * 1. Deposits Asset into underlying pool by Owner
   * 1. Transfers Assets from Owner to depositors[]
   * 2. Transfers YBT from Owner to depositors[]
   */
  async setupAccounts(owner:Signer, depositors:[Signer,number][]): Promise<void> {
    if (!this.tempus)
      throw new Error('setupAccounts: createTempusPool not called');
    
    const totalDeposit = depositors.reduce((sum, current) => sum + current[1], 100);
    await this.deposit(owner, totalDeposit);

    for (let depositor of depositors) { // initial deposit for users
      const user = depositor[0];
      const amount = depositor[1];
      await this.asset().transfer(owner, user, 100000); // TODO: make this a parameter?
      await this.tempus.yieldBearing.transfer(owner, user, amount);
    }
  }

  /**
   * @returns Balances state for a single user
   */
  async userState(user:Signer): Promise<UserState> {
    let state = new UserState();
    state.principalShares = Number(await this.tempus.principalShare.balanceOf(user));
    state.yieldShares = Number(await this.tempus.yieldShare.balanceOf(user));
    state.yieldBearing = Number(await this.yieldTokenBalance(user));
    return state;
  }

  protected async createPool(
    initialRate:number,
    poolDuration:number,
    yieldEst:number,
    tpsName:string,
    tysName:string,
    newPool: ()=>Promise<any>,
    restorePool: (contracts:any)=>void
  ): Promise<TempusPool> {
    this.initialRate = initialRate;
    this.yieldEst = yieldEst;
    this.poolDuration = poolDuration;

    const signature = this.type+"|"+initialRate+"|"+poolDuration+"|"+yieldEst;
    let f:FixtureState = POOL_FIXTURES[signature];

    if (!f) // initialize a new fixture
    {
      const maturityTime = await blockTimestamp() + poolDuration;
      const names = generateTempusSharesNames(tpsName, tysName, maturityTime);
      f = new FixtureState(maturityTime, names, deployments.createFixture(async () =>
      {
        await deployments.fixture(undefined, { keepExistingDeployments: true, });
        // Note: for fixtures, all contracts must be initialized inside this callback
        const contracts = await newPool();
        const t = await TempusPool.deploy(this.type, this.yieldToken(), maturityTime, yieldEst, names);
        const [owner,user,user2] = await ethers.getSigners();
        return {
          signers: { owner:owner, user:user, user2:user2 },
          contracts: { ...contracts, tc:t.contract, tps:t.principalShare.contract, tys:t.yieldShare.contract}
        };
      }));
      POOL_FIXTURES[signature] = f; // save for later use
    }

    // always restore pool from fixture (that's just the way the fixture approach works bro)
    const s = await f.getInitialContractState();
    this.maturityTime = f.maturityTime;
    this.names = f.names;
    this.signers = [s.signers.owner, s.signers.user, s.signers.user2];

    restorePool(s.contracts);
    const principals = new PoolShare("PrincipalShare", s.contracts.tps);
    const yields = new PoolShare("YieldShare", s.contracts.tys);
    return new TempusPool(this.type, s.contracts.tc, this.yieldToken(), principals, yields);
  }
}

