import { expect } from "chai";
import { Signer } from "@tempus-labs/utils/ts/utils/ContractBase";
import { generateTempusSharesNames, TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { blockTimestamp, evmMine, evmSetAutomine, expectRevert, increaseTime, setEvmTime } from "@tempus-labs/utils/ts/utils/Utils";
import { describeForEachPool } from "./pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "@tempus-sdk/tempus/PoolTestFixture";
import { TempusPoolAMM } from "@tempus-sdk/tempus/TempusPoolAMM";
import { PoolShare, ShareKind } from "@tempus-sdk/tempus/PoolShare";
import { LPVault } from "@tempus-sdk/tempus/LPVault";
import { Stats } from "@tempus-sdk/tempus/Stats";

interface CreateParams {
  yieldEst:number;
  duration:number;
  amplifyStart:number;
  amplifyEnd:number;
  oneAmpUpdate?:number;
  ammBalanceYield?: number;
  ammBalancePrincipal?:number;
}

type PoolAndAmm = {
  pool: TempusPool;
  amm: TempusPoolAMM;
}

describeForEachPool("LPVault", (testFixture:PoolTestFixture) =>
{
  let owner:Signer;
  const SWAP_FEE_PERC:number = 0.02;
  const ONE_HOUR:number = 60*60;
  const ONE_DAY:number = ONE_HOUR*24;
  const ONE_MONTH:number = ONE_DAY*30;
  const ONE_YEAR:number = ONE_MONTH*12;
  const ONE_AMP_UPDATE_TIME:number = ONE_DAY;

  let stats:Stats;
  let lpVault:LPVault;
  
  async function createPools(params:CreateParams): Promise<PoolAndAmm> {
    const pool = await testFixture.createWithAMM({
      initialRate:1.0, poolDuration:params.duration, yieldEst:params.yieldEst,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: params.amplifyStart,
      ammAmplifyEnd: params.amplifyStart /*NOTE: using Start value here to not trigger update yet */
    });

    [owner] = testFixture.signers;

    await provideLiquidity(params, pool, testFixture.amm);
    await createVault(pool, testFixture.amm);
    return {pool: pool, amm: testFixture.amm};
  }

  async function createSecondPool(oldPool:TempusPool, params:CreateParams): Promise<PoolAndAmm> {
    const controller = oldPool.controller;
    const asset = oldPool.asset;
    const ybt = oldPool.yieldBearing;
    const maturityTime = await blockTimestamp() + params.duration;
    const names = generateTempusSharesNames(await ybt.name(), await ybt.symbol(), maturityTime);

    // initialize new tempus pool with the controller, TempusPool is auto-registered
    const newPool = await TempusPool.deploy(
      oldPool.type, owner, controller, asset, ybt, maturityTime, params.yieldEst, names, oldPool.underlyingProtocolAddr
    );

    // new AMM instance and register the AMM with the controller
    const amm = await TempusPoolAMM.create(owner, controller, newPool.principalShare, newPool.yieldShare, 
      params.amplifyStart, params.amplifyEnd, maturityTime, SWAP_FEE_PERC
    );

    await provideLiquidity(params, newPool, amm);

    return {pool: newPool, amm: amm};
  }

  async function provideLiquidity(params:CreateParams, pool:TempusPool, amm:TempusPoolAMM) {
    const backingAmount = 1_000_000;
    const ybtAmount = 10_000;
    // TODO: is this approve needed once we have Permit support?
    await pool.asset.approve(owner, pool.controller, backingAmount);
    await pool.controller.depositBacking(owner, pool, backingAmount);

    // we need some surplus YBT balance for Vault testing as well
    await pool.controller.redeemToYieldBearing(owner, pool, ybtAmount, ybtAmount, owner);

    if (params.ammBalanceYield != undefined && params.ammBalancePrincipal != undefined) {
      await amm.provideLiquidity(owner, params.ammBalancePrincipal, params.ammBalanceYield);
    }

    if (params.amplifyStart != params.amplifyEnd) {
      const oneAmplifyUpdate = (params.oneAmpUpdate === undefined) ? ONE_AMP_UPDATE_TIME : params.oneAmpUpdate;
      await amm.startAmplificationUpdate(params.amplifyEnd, oneAmplifyUpdate);
    }
  }

  async function createVault(pool: TempusPool, amm: TempusPoolAMM): Promise<void> {
    stats = await Stats.create();
    lpVault = await LPVault.create(pool, amm, stats, "Tempus LP Vault", "PVALT");
  }

  it("Roundtrip (deposit+withdraw) test", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10_000, ammBalanceYield: 100_000});
    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.be.within(99.9999, 100.0002);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.be.within(199.9999, 200.0002);
    await lpVault.withdraw(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.be.within(99.9999, 100.0002);
  });

  it("Total assets on empty vault", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10_000, ammBalanceYield: 100_000});
    expect(+await lpVault.totalAssets()).to.equal(0);
  });

  it("Shutdown status of empty vault", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10_000, ammBalanceYield: 100_000});
    expect(await lpVault.isShutdown()).to.false;
  });

  it("Preview deposit", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10_000, ammBalanceYield: 100_000});
    expect(+await lpVault.previewDeposit(owner, 100)).to.be.within(99.9999, 100.0002);
  });

  it("Preview withdraw", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10_000, ammBalanceYield: 100_000});
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.previewWithdraw(owner, 100)).to.be.within(99.9999, 100.0002);
  });

  it("Withdraw completely upon maturity", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(100);

    await evmMine(); // force-mine a block to avoid timestamp issues
    await setEvmTime((+await pool.maturityTime()) + 1);
    await pool.finalize();
    expect(await pool.matured()).to.be.true;

    await lpVault.withdraw(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(0);

  });

  it("Withdraw partially upon maturity", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(100);

    await evmMine(); // force-mine a block to avoid timestamp issues
    await setEvmTime((+await pool.maturityTime()) + 1);
    await pool.finalize();
    expect(await pool.matured()).to.be.true;

    await lpVault.withdraw(owner, 50, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(50);
    await lpVault.withdraw(owner, 50, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(0);
  });

  it("Shutdown multiple times", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    expect(await lpVault.isShutdown()).to.false;
    await lpVault.shutdown(owner);
    expect(await lpVault.isShutdown()).to.true;
    await lpVault.shutdown(owner);
    expect(await lpVault.isShutdown()).to.true;
  });

  it("Deposit after shutdown", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await lpVault.shutdown(owner);

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    (await expectRevert(lpVault.deposit(owner, 100, owner))).to.equal(":VaultIsShutdown");
  });

  it("Deposit after maturity", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    await evmMine(); // force-mine a block to avoid timestamp issues
    await setEvmTime((+await pool.maturityTime()) + 1);
    await pool.finalize();
    expect(await pool.matured()).to.be.true;

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    (await expectRevert(lpVault.deposit(owner, 100, owner))).to.equal(":VaultHasNoActivePool");
  });

  it("Withdraw after shutdown before maturity", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(100);

    await lpVault.shutdown(owner);

    await lpVault.withdraw(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(0);
  });

  it("Withdraw after shutdown after maturity", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(100);

    await evmMine(); // force-mine a block to avoid timestamp issues
    await setEvmTime((+await pool.maturityTime()) + 1);
    await pool.finalize();
    expect(await pool.matured()).to.be.true;

    await lpVault.shutdown(owner);

    await lpVault.withdraw(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(0);
  });

  it("Migrate to self", async () => {
    const pool = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await createVault(pool.pool, pool.amm);
    (await expectRevert(lpVault.migrate(owner, pool.pool, pool.amm, stats)))
      .to.equal(":CannotMigrateToSamePool");
  });

  it("Early migrate", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    const {pool:newPool,amm:newAmm} = await createSecondPool(pool, {yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    
    (await expectRevert(lpVault.migrate(owner, newPool, newAmm, stats)))
      .to.equal(":CurrentPoolNotMaturedYet");
  });

  it("Migrate without deposits", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await evmMine(); // force-mine a block to avoid timestamp issues
    await setEvmTime((+await pool.maturityTime()) + 1);
    await pool.finalize();
    expect(await pool.matured()).to.be.true;

    const {pool:newPool,amm:newAmm} = await createSecondPool(pool, {yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await lpVault.migrate(owner, newPool, newAmm, stats);
  });

  it("Migrate with deposits", async () => {
    const {pool,amm} = await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    expect(+await lpVault.balanceOf(owner)).to.equal(0);
    await lpVault.ybt.approve(owner, lpVault.address, 200);
    await lpVault.deposit(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(100);

    await evmMine(); // force-mine a block to avoid timestamp issues
    await setEvmTime((+await pool.maturityTime()) + 1);
    await pool.finalize();
    expect(await pool.matured()).to.be.true;

    const {pool:newPool,amm:newAmm} = await createSecondPool(pool, {yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await lpVault.migrate(owner, newPool, newAmm, stats);

    expect(+await lpVault.balanceOf(owner)).to.equal(100);
    await lpVault.withdraw(owner, 100, owner);
    expect(+await lpVault.balanceOf(owner)).to.equal(0);
  });
});
