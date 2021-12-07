import { expect } from "chai";
import {
  ethers,
  deployments,
  getNamedAccounts,
  getUnnamedAccounts
} from 'hardhat';
import { blockTimestamp, evmMine, evmSetAutomine, increaseTime } from '../test/utils/Utils';
import { generateTempusSharesNames, TempusPool } from "../test/utils/TempusPool";
import { ERC20 } from "../test/utils/ERC20";
import { TempusController } from "../test/utils/TempusController";
import { fromWei, toWei } from "../test/utils/Decimal";
import Decimal from "decimal.js";

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, {
    keepExistingDeployments: true, // global option to test network like that
  });
  
  const owner = (await ethers.getSigners())[0];
  const { daiHolder } = await getNamedAccounts();
  const [ account1, account2 ] = await getUnnamedAccounts();
  const daiHolderSigner = await ethers.getSigner(daiHolder);

  const daiBackingToken = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
  const yvDaiYieldToken = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('yvDAI')));
  
  const yvDaiVault = await ethers.getContract('yvDAI'); 
  
  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr
  const names = generateTempusSharesNames("yvDai yearn token", "yvDAI", maturityTime);
  const yieldEst = 0.1;
  const controller: TempusController = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployYearn(
    owner, daiBackingToken, yvDaiYieldToken, controller, maturityTime, yieldEst, names
  );
  
  await daiBackingToken.transfer(daiHolderSigner, account1, 10000);
  await daiBackingToken.transfer(daiHolderSigner, account2, 10000);
  
  return {
    contracts: {
      yvDaiVault,
      tempusPool,
      dai: daiBackingToken,
      yvDai: yvDaiYieldToken
    },
    signers: {
      daiHolder: daiHolderSigner,
      signer1: await ethers.getSigner(account1),
      signer2: await ethers.getSigner(account2)
    }
  };
});

describe('TempusPool <> Yearn', function () {
  it('Verifies that depositing directly to Yearn accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Yearn
    //   vs depositing to Yearn via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-12; // 0.00000001% error
    const { signers: { signer1, signer2 }, contracts: { dai, yvDai, yvDaiVault, tempusPool }} = await setup();
    
    expect(+await yvDai.balanceOf(signer1)).to.equal(0);
    expect(+await yvDai.balanceOf(signer2)).to.equal(0);
    
    const depositAmount: number = 100;
    
    await dai.approve(signer1, tempusPool.controller.address, depositAmount);
    await dai.approve(signer2, yvDaiVault.address, depositAmount);
    await dai.approve(signer2, tempusPool.controller.address, "1234.5678901234");
    
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.5678901234"); // deposit some BT to the pool before 
    
    const btBalancePreSigner1 = await dai.balanceOf(signer1.address);
    const btBalancePreSigner2 = await dai.balanceOf(signer2.address);
    
    await evmSetAutomine(false);
    
    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    await yvDaiVault.connect(signer2).deposit(toWei(depositAmount)); // deposit directly to Yearn
    
    await evmMine();
    await evmSetAutomine(true);
    await increaseTime(60 * 60 * 24 * 30 * 12); // Increase time by 1 year
    
    const yieldShareBalanceSigner1 = await tempusPool.yieldShare.balanceOf(signer1);

    await evmSetAutomine(false);
    
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, yieldShareBalanceSigner1, yieldShareBalanceSigner1, signer1.address)
    await yvDaiVault.connect(signer2).withdraw(ethers.constants.MaxUint256, signer2.address); // deposit directly to Yearn
    await evmMine();
    await evmSetAutomine(true);

    const btBalancePostSigner1 = await dai.balanceOf(signer1);
    const btBalancePostSigner2 = await dai.balanceOf(signer2);
    const totalInterestSigner1 = toWei(btBalancePostSigner1).sub(toWei(btBalancePreSigner1));
    const totalInterestSigner2 = toWei(btBalancePostSigner2).sub(toWei(btBalancePreSigner2));
    
    const error = new Decimal(1).sub(new Decimal(fromWei(totalInterestSigner2).toString())
      .div(fromWei(totalInterestSigner1).toString())).abs()
    
    expect(error.lessThanOrEqualTo(MAX_ALLOWED_INTEREST_DELTA_ERROR), `error is too high - ${error}`).to.be.true;
  });
});
