import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { describeForSinglePool } from "../test/pool-utils/MultiPoolTestSuite";
import { blockTimestamp, evmMine, evmMineInSingleBlock } from '@tempus-sdk/utils/Utils';
import { generateTempusSharesNames, TempusPool, PoolType } from "@tempus-sdk/tempus/TempusPool";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { bn, Numberish, toWei } from "@tempus-sdk/utils/DecimalUtils";
import { Balances, getAccounts } from "./IntegrationUtils";
import { Addressable } from "@tempus-sdk/utils/ContractBase";

const setupDai = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true, });

  const { owner, holder, signer1, signer2 } = await getAccounts("daiHolder");

  const dai = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
  const cDai = new ERC20("ICErc20", 8, (await ethers.getContract('cToken_Dai')));

  const maturityTime = await blockTimestamp() + 60*60*24*5; // maturity is in 5 days
  const names = generateTempusSharesNames("cDai compound token", "cDai", maturityTime);
  const yieldEst = 0.1;
  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployCompound(
    owner, dai, cDai, controller, maturityTime, yieldEst, names
  );

  await dai.transfer(holder, signer1, 100000);
  await dai.transfer(holder, signer2, 100000);
  return { contracts: { tempusPool, dai, cDai }, signers: { signer1, signer2 } };
});

const setupUsdc = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true, });

  const { owner, holder, signer1, signer2 } = await getAccounts("usdcHolder");

  const usdc = new ERC20("ERC20FixedSupply", 6, (await ethers.getContract('Usdc')));
  const cUsdc = new ERC20("ICErc20", 8, await ethers.getContract("cToken_Usdc"));
  
  const maturityTime = await blockTimestamp() + 60*60*24*5; // maturity is in 5 days
  const names = generateTempusSharesNames("cUsdc compound token", "cUsdc", maturityTime);
  const yieldEst = 0.1;
  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployCompound(
    owner, usdc, cUsdc, controller, maturityTime, yieldEst, names
  );

  await usdc.transfer(holder, signer1, 10000);
  await usdc.transfer(holder, signer2, 10000);
  return { contracts: { tempusPool, usdc, cUsdc }, signers: { signer1, signer2 } };
});

async function depositBacking(user:Addressable, pool:TempusPool, amount:Numberish) {
  await pool.asset.approve(user, pool.controller, amount);
  await pool.controller.depositBacking(user, pool, amount, user);
}

describeForSinglePool('TempusPool', PoolType.Compound, 'USDC', () =>
{
  it('Verify minted shares', async () => {
    const { signers: { signer1 }, contracts: { usdc, cUsdc, tempusPool }} = await setupUsdc();

    const depositAmount: number = 100;
    await depositBacking(signer1, tempusPool, depositAmount);
    const principals = await tempusPool.principalShare.balanceOf(signer1);
    expect(+principals).to.be.within(depositAmount * 0.9999, depositAmount * 1.0001);
  });

  it('Verify withdrawn backing tokens', async () => {
    const { signers: { signer1 }, contracts: { usdc, cUsdc, tempusPool }} = await setupUsdc();

    const depositAmount: number = 100;
    const oldBalance = +await usdc.balanceOf(signer1);
    await depositBacking(signer1, tempusPool, depositAmount);

    const principals = await tempusPool.principalShare.balanceOf(signer1);
    const yields = await tempusPool.yieldShare.balanceOf(signer1);
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, principals, yields, signer1);

    expect(+await usdc.balanceOf(signer1)).to.be.within(oldBalance * 0.9999, oldBalance * 1.0001);
  });
});

describeForSinglePool('TempusPool', PoolType.Compound, 'DAI', () => {
  it('Verifies that depositing directly to Compound accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Compound
    //    vs depositing to Compound via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-6; // 0.000001% error
    const { signers: { signer1, signer2 }, contracts: { dai, cDai, tempusPool }} = await setupDai();
    expect(+await cDai.balanceOf(signer1)).to.equal(0);
    expect(+await cDai.balanceOf(signer2)).to.equal(0);

    const depositAmount: number = 100;
    await depositBacking(signer2, tempusPool, "12345.678901234");  // deposit some BT to the pool before 

    const preBalances = await Balances.getBalances(dai, signer1, signer2);

    await evmMineInSingleBlock(async () =>
    {
      await depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before
      await dai.approve(signer2, cDai, depositAmount);
      await cDai.connect(signer2).mint(toWei(depositAmount)); // deposit directly to Compound
    });
    
    // mine a bunch of blocks to accrue interest
    for (let i = 0; i < 10000; i++) {
      await evmMine();
    }

    await evmMineInSingleBlock(async () =>
    {
      const singer1yields = await tempusPool.yieldShare.balanceOf(signer1);
      await tempusPool.controller.redeemToBacking(signer1, tempusPool, singer1yields, singer1yields, signer1);
      await cDai.connect(signer2).redeem(bn(await cDai.balanceOf(signer2)));
    });

    const error = await preBalances.getInterestDeltaError();
    expect(+error).to.be.lessThanOrEqual(MAX_ALLOWED_INTEREST_DELTA_ERROR, `error is too high - ${error}`);
  });
});
