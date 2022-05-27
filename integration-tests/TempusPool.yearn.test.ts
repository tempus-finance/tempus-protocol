import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { describeForSinglePool } from "../test/pool-utils/MultiPoolTestSuite";
import { blockTimestamp, evmMineInSingleBlock, increaseTime } from '@tempus-sdk/utils/Utils';
import { generateTempusSharesNames, PoolType, TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { Balances, getAccounts } from "./IntegrationUtils";

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true });

  const { owner, holder, signer1, signer2 } = await getAccounts("daiHolder");

  const dai = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
  const yvDai = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('yvDAI')));
  const yvDaiVault = await ethers.getContract('yvDAI'); 

  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr
  const names = generateTempusSharesNames("yvDai yearn token", "yvDAI", maturityTime);
  const yieldEst = 0.1;
  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployYearn(
    owner, dai, yvDai, controller, maturityTime, yieldEst, names
  );

  await dai.transfer(holder, signer1, 10000);
  await dai.transfer(holder, signer2, 10000);
  return {
    contracts: { yvDaiVault, tempusPool, dai, yvDai },
    signers: { signer1, signer2 }
  };
});

describeForSinglePool('TempusPool', PoolType.Yearn, 'DAI', function () {
  it('Verifies that depositing directly to Yearn accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Yearn
    //   vs depositing to Yearn via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-12; // 0.00000001% error
    const { signers: { signer1, signer2 }, contracts: { dai, yvDai, yvDaiVault, tempusPool }} = await setup();
    expect(+await yvDai.balanceOf(signer1)).to.equal(0);
    expect(+await yvDai.balanceOf(signer2)).to.equal(0);

    const depositAmount = 100;
    await dai.approve(signer1, tempusPool.controller, depositAmount);
    await dai.approve(signer2, yvDaiVault, depositAmount);
    await dai.approve(signer2, tempusPool.controller, "1234.5678901234");
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.5678901234"); // deposit some BT to the pool before 

    const preBalances = await Balances.getBalances(dai, signer1, signer2);

    await evmMineInSingleBlock(async () =>
    {
      await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
      await yvDaiVault.connect(signer2).deposit(dai.toBigNum(depositAmount)); // deposit directly to Yearn
    });
    await increaseTime(60 * 60 * 24 * 30 * 12); // Increase time by 1 year

    await evmMineInSingleBlock(async () =>
    {
      const signer1yields = await tempusPool.yieldShare.balanceOf(signer1);
      await tempusPool.controller.redeemToBacking(signer1, tempusPool, signer1yields, signer1yields, signer1)
      await yvDaiVault.connect(signer2).withdraw(ethers.constants.MaxUint256, signer2.address); // deposit directly to Yearn
    });

    const error = await preBalances.getInterestDeltaError();
    expect(+error).to.be.lessThanOrEqual(MAX_ALLOWED_INTEREST_DELTA_ERROR, `error is too high - ${error}`);
  });
});
