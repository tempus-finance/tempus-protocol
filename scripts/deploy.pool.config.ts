import { ethers, network } from 'hardhat';
import * as utils from './utils';
import * as chalk from "chalk";
import { generateTempusSharesNames } from '../test/utils/TempusPool';


const EXCHANGE_RATE_PRECISION = 18;
const YBT_PRECISION = 18;
const YBT_NAME = "Lido staked ETH";
const YBT_SYMBOL = "stETH";
const CONTRACT_NAME = "LidoTempusPool";
const MONTH = 60 * 60 * 24 * 30;

async function deploy() {
  const deployerPrivateKey = await utils.promptPrivateKey("Enter deployer Private Key");

  console.log(chalk.green(`* * * ${CONTRACT_NAME} configuration * * *`));
  const lido = await utils.promptAddress("Enter the address of the Lido contract", (await utils.getDeployedContractAddress(network.name, 'Lido')));
  const tempusController = await utils.promptAddress("Enter the address of the TempuController contract", (await utils.getDeployedContractAddress(network.name, 'TempusController')));
  const maturityYear = await utils.promptNumber("Enter pool maturity year", null, 2021, 2025);
  const maturityMonth = await utils.promptNumber("Enter pool maturity month", null, 1, 12);
  const maturityDay = await utils.promptNumber("Enter pool maturity day", null, 1, 31);
  const maturityHour = await utils.promptNumber("Enter pool maturity hour", null, 0, 23);
  const maturityMinute = await utils.promptNumber("Enter pool maturity minute", null, 0, 59);
  const estimatedYield = await utils.promptNumber("Enter estimated yield", null, 0.0001, 1);
  const depositMaxFee = await utils.promptNumber("Enter maximum deposit fee", null, 0, 1);
  const earlyRedemptionMaxFee = await utils.promptNumber("Enter maximum early redemption fee", null, 0, 1);
  const maturedRedemptionMaxFee = await utils.promptNumber("Enter maximum matured redemption fee", null, 0, 1);
  const referrer = await utils.promptAddress("Enter the address of the Lido Referrer");
  
  console.log(chalk.green(`* * * TempusAMM configuration * * *`));
  const balancerVault = await utils.promptAddress("Enter the address of the Balancer Vault contract", (await utils.getDeployedContractAddress(network.name, 'Vault')));
  const lpName = await utils.promptInput("Enter LP token Name", `Tempus ${YBT_SYMBOL} LP Token`);
  const lpSymbol = await utils.promptInput("Enter LP token Symbol", `TLP${YBT_SYMBOL}`);
  const amplificationStart = await utils.promptNumber("Enter initial Amplification Factor", 5, 1, 5000);
  const amplificationEnd = await utils.promptNumber("Enter final Amplification Factor", 95, 1, 5000);
  const swapFeePercentage = await utils.promptNumber("Enter Swap Fee percentage (e.g. - 0.02 to represent 2%)", 0.01, 0, 0.1);
  const pauseWindowDuration = await utils.promptNumber("Enter Pause Window Duration (in seconds)", 3 * MONTH, 0);
  const bufferPeriodDuration = await utils.promptNumber("Enter Buffer Period Duration (in seconds)", MONTH, 0);
  const owner = await utils.promptAddress("Enter Owner address");

  const maturityTimestamp = new Date(
    Date.UTC(
      maturityYear,
      maturityMonth - 1, /// month range is 0-11 for some reason (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/UTC)
      maturityDay,
      maturityHour,
      maturityMinute
    )
  ).getTime() / 1000;
  
  const sharesData = generateTempusSharesNames(YBT_NAME, YBT_SYMBOL, maturityTimestamp)
  const poolConstructorArgs = [
    lido,
    tempusController,
    maturityTimestamp,
    ethers.utils.parseUnits(estimatedYield, EXCHANGE_RATE_PRECISION).toString(),
    /*principalsData*/{
      name: sharesData.principalName, 
      symbol: sharesData.principalSymbol
    },
    /*yieldsData*/{
      name: sharesData.yieldName, 
      symbol: sharesData.yieldSymbol
    },
    /*maxFeeSetup:*/{
      depositPercent:      ethers.utils.parseUnits(depositMaxFee, YBT_PRECISION).toString(),
      earlyRedeemPercent:  ethers.utils.parseUnits(earlyRedemptionMaxFee, YBT_PRECISION).toString(),
      matureRedeemPercent: ethers.utils.parseUnits(maturedRedemptionMaxFee, YBT_PRECISION).toString()
    },
    referrer
  ];



  console.log(chalk.yellow(`${CONTRACT_NAME} constructor arguments: `));
  console.log(chalk.green(JSON.stringify(poolConstructorArgs)));
  if (!(await utils.toggleConfirm("Do you confirm the constructor arguments?"))) {
    console.log(chalk.yellow('Constructor arguments not confirmed.'));
    process.exit(0)
  }

  console.log(chalk.yellow(`TempusAMM constructor arguments: `));
  console.log(chalk.green(JSON.stringify({
    balancerVault,
    lpName,
    lpSymbol,
    amplificationStart,
    amplificationEnd,
    swapFeePercentage: ethers.utils.parseUnits(swapFeePercentage.toString(), 18).toString(),
    pauseWindowDuration,
    bufferPeriodDuration,
    owner
  })));
  if (!(await utils.toggleConfirm("Do you confirm the constructor arguments?"))) {
    console.log(chalk.yellow('Constructor arguments not confirmed.'));
    process.exit(0)
  }

  const tempusPoolContract = await utils.deployContract(CONTRACT_NAME, poolConstructorArgs, deployerPrivateKey);
  await utils.waitForContractToBeDeployed(tempusPoolContract.address);

  const ammConstructorArgs = [
    balancerVault,
    lpName,
    lpSymbol,
    tempusPoolContract.address,
    amplificationStart,
    amplificationEnd,
    ethers.utils.parseUnits(swapFeePercentage.toString(), 18).toString(),
    pauseWindowDuration,
    bufferPeriodDuration,
    owner
  ];

  // Deploy AMM with a hardcoded 5.5M gas limit because otherwise gas estimation fails sometimes for some reason
  const tempusAmmContract = await utils.deployContract("TempusAMM", ammConstructorArgs, deployerPrivateKey, 5500000);
  await utils.waitForContractToBeDeployed(tempusAmmContract.address);
  
  await utils.generateDeployment(tempusPoolContract, `${CONTRACT_NAME}_${YBT_SYMBOL}_maturity-${maturityTimestamp}`, network.name);
  await utils.generateDeployment(tempusAmmContract, `TempusAMM_${YBT_SYMBOL}_maturity-${maturityTimestamp}`, network.name);
}


deploy();
