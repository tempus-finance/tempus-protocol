import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { describeForSinglePool } from "../test/pool-utils/MultiPoolTestSuite";
import { blockTimestamp } from '../test/utils/Utils';
import { generateTempusSharesNames, TempusPool, PoolType } from "../test/utils/TempusPool";
import { TempusController } from "../test/utils/TempusController";
import { ERC20 } from "../test/utils/ERC20";
import { ERC20Ether } from "../test/utils/ERC20Ether";
import { parseDecimal, toWei, bn } from "../test/utils/DecimalUtils";
import { Balances, getNamedSigners, getAccounts } from "./IntegrationUtils";

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true });
  
  const { owner, signer1, signer2 } = await getAccounts();
  const [ lidoOracleMember1, lidoOracleMember2, lidoOracleMember3 ] = await getNamedSigners([
    'lidoOracleMember1', 'lidoOracleMember2', 'lidoOracleMember3'
  ]);

  // NOTE: using Weth here as a mock ETH ticker for the testing system
  // Lido actually uses native ETH
  const eth = new ERC20Ether();
  const lido = new ERC20("ILido", 18, (await ethers.getContract('Lido')));
  const lidoOracle = await ethers.getContract('LidoOracle');

  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr
  const names = generateTempusSharesNames("Lido stETH", "stETH", maturityTime);
  const yieldEst = 0.1;

  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployLido(
    owner, eth, lido, controller, maturityTime, yieldEst, names
  );

  return {
    contracts: { lido, tempusPool, lidoOracle },
    signers: { signer1, signer2, lidoOracleMember1, lidoOracleMember2, lidoOracleMember3, }
  };
});

describeForSinglePool('TempusPool', PoolType.Lido, 'ETH', () => {
  it('Verifies that depositing directly to Lido accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Lido
    //    vs depositing to Lido via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-18; // 0.0000000000000001% error
    const { 
      signers: { signer1, signer2, lidoOracleMember1, lidoOracleMember2, lidoOracleMember3 },
      contracts: { lido, tempusPool, lidoOracle }
    } = await setup();

    const depositAmount: number = 100;
    const initialPoolYieldBearingBalance = "12345.678901234";
    await tempusPool.controller.depositBacking(signer2, tempusPool, initialPoolYieldBearingBalance, signer2, initialPoolYieldBearingBalance); // deposit some BT to the pool before 

    const preBalances = await Balances.getBalances(tempusPool.yieldBearing, signer1, signer2);

    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount, signer1, depositAmount); // deposit some BT to the pool before 
    await lido.connect(signer2).submit('0x1234567895e8bbcfc9581d2e864a68feb6a076d3', { value: toWei(depositAmount) }); // deposit directly to Lido

    // This increases Lido's yield
    const { beaconValidators, beaconBalance } = await lido.contract.getBeaconStat();
    const newBeaconBalance = bn(beaconBalance).add(toWei(100)).div(parseDecimal('1', 9));
    await lidoOracle.connect(lidoOracleMember1).reportBeacon((await lidoOracle.getExpectedEpochId()), newBeaconBalance, beaconValidators);
    await lidoOracle.connect(lidoOracleMember2).reportBeacon((await lidoOracle.getExpectedEpochId()), newBeaconBalance, beaconValidators);
    await lidoOracle.connect(lidoOracleMember3).reportBeacon((await lidoOracle.getExpectedEpochId()), newBeaconBalance, beaconValidators);

    const signer1yields = await tempusPool.yieldShare.balanceOf(signer1);
    await tempusPool.controller.redeemToYieldBearing(signer1, tempusPool, signer1yields, signer1yields, signer1)

    const error = await preBalances.getInterestDeltaError();
    expect(+error).to.be.lessThanOrEqual(MAX_ALLOWED_INTEREST_DELTA_ERROR, `error is too high - ${error}`);
  });
});
