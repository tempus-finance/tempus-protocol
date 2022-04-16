import { writeFileSync, readFileSync } from 'fs';
import { ethers, network } from 'hardhat';
import { Contract } from '@ethersproject/contracts';
import * as utils from './utils';
import * as chalk from "chalk";
import { parseDecimal } from "../test/utils/Decimal";
import { ERC20 } from "../test/utils/ERC20";
import { AMP_PRECISION } from '../test/utils/TempusAMM';

interface YBTConfig {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
}

interface TokenInfo {
  address:string,
  name: string;
  symbol: string;
}

interface FeesConfig {
  deposit: number;
  earlyRedemption: number;
  maturedRedemption: number;
}

interface PoolConfig {
  address?: string;
  owner?: string;
  maturity: string;
  estimatedYield: string;
  fees: FeesConfig;
}

interface AMMConfig {
  address?: string;
  lp: TokenInfo;
  owner: string;
  swapFee: number;
  initialAmplificationFactor: number;
  finalAmplificationFactor: number;
}

interface LidoConfig {
  referrer: string;
}

interface RariConfig {
  fundManager: string;
}

interface Config {
  kind: string;
  lido?: LidoConfig;
  rari?: RariConfig;
  decimals: number;
  ybt: YBTConfig;
  controller: string;
  principal: TokenInfo;
  yield: TokenInfo;
  pool: PoolConfig;
  amm: AMMConfig;
}

function validateRange(value:number, min:number, max:number) {
  if (value < min) {
    console.log(chalk.red(`Value ${value} below minimum of ${min}`));
    process.exit(1);
  } else if (value > max) {
    console.log(chalk.red(`Value ${value} above maximum of ${max}`));
    process.exit(1);
  }
}

async function validateYBT(ybtConfig:YBTConfig, signer) {
  const ybt = await ERC20.attachWithSigner("ERC20FixedSupply", ybtConfig.address, signer);

  const decimals = ybt.decimals;
  const name = await ybt.name();
  const symbol = await ybt.symbol();

  // Validate YBT details
  if (ybtConfig.decimals !== decimals) {
    console.log(chalk.red(`YBT: decimals mismatch: ${ybtConfig.decimals} vs ${decimals}`));
    process.exit(1);
  }
  if (ybtConfig.name !== name) {
    console.log(chalk.red(`YBT: name mismatch: ${ybtConfig.name} vs ${name}`));
    process.exit(1);
  }
  if (ybtConfig.symbol !== symbol) {
    console.log(chalk.red(`YBT: symbol mismatch: ${ybtConfig.symbol} vs ${symbol}`));
    process.exit(1);
  }
}

async function confirmAndDeploy(contractName:string, directory:string, label:string, args:any, deployerPrivateKey:string, gasLimit?:number): Promise<Contract> {
  console.log(chalk.yellow(`${contractName} constructor arguments: `));
  console.log(chalk.green(JSON.stringify(args)));
  if (!(await utils.toggleConfirm("Do you confirm the constructor arguments?"))) {
    console.log(chalk.yellow('Constructor arguments not confirmed.'));
    process.exit(0)
  }

  const contractInstance = await utils.deployContract(contractName, args, deployerPrivateKey, gasLimit);
  await utils.waitForContractToBeDeployed(contractInstance.address);

  await utils.generateDeployment(contractInstance, label, directory);

  return contractInstance;
}

async function deployPool(config:Config, deployerPrivateKey:string): Promise<Config> {
  const signer = new ethers.Wallet(deployerPrivateKey).connect(ethers.provider);

  await validateYBT(config.ybt, signer);

  validateRange(config.decimals, 0, 33);
  validateRange(config.ybt.decimals, 0, 33);
  validateRange(Number(config.pool.estimatedYield), 0, 1);
  validateRange(config.pool.fees.deposit, 0, 0.05);
  validateRange(config.pool.fees.earlyRedemption, 0, 0.05);
  validateRange(config.pool.fees.maturedRedemption, 0, 0.05);

  let contractName;
  let customPoolConstructorArgs = [];
  if (config.kind === "Lido") {
    contractName = "LidoTempusPool";
    if (config.lido.referrer) {
      customPoolConstructorArgs.push(config.lido.referrer);
    }
  } else if (config.kind === "Yearn") {
    contractName = "YearnTempusPool";
  } else if (config.kind === "Rari") {
    contractName = "RariTempusPool";
  } else {
    console.log("No suitable protocol found");
    process.exit(1);
  }

  const maturityTimestamp = Date.parse(config.pool.maturity) / 1000;
  
  const poolConstructorArgs = [
    config.ybt.address,
    config.controller,
    maturityTimestamp,
    parseDecimal(config.pool.estimatedYield, config.decimals),
    /*principalsData*/{
      name: config.principal.name,
      symbol: config.principal.symbol
    },
    /*yieldsData*/{
      name: config.yield.name,
      symbol: config.yield.symbol
    },
    /*maxFeeSetup:*/{
      depositPercent:      parseDecimal(config.pool.fees.deposit, config.ybt.decimals),
      earlyRedeemPercent:  parseDecimal(config.pool.fees.earlyRedemption, config.ybt.decimals),
      matureRedeemPercent: parseDecimal(config.pool.fees.maturedRedemption, config.ybt.decimals)
    }
  ].concat(customPoolConstructorArgs);

  // NOTE: special case for Rari
  if (config.kind === "Rari") {
    // Insert fundManager as first argument
    poolConstructorArgs.splice(0, 0, config.rari.fundManager);
  }

  const ybtSymbol = config.ybt.symbol;
  const tempusPoolContract = await confirmAndDeploy(
    contractName,
    network.name,
    `${contractName}_${ybtSymbol}_maturity-${maturityTimestamp}`,
    poolConstructorArgs,
    deployerPrivateKey
  );

  config.pool.address = tempusPoolContract.address;
  config.pool.owner = await tempusPoolContract.owner();

  config.principal.address = await tempusPoolContract.principalShare();
  config.yield.address = await tempusPoolContract.yieldShare();

  return config;
}

async function deployAmm(config:Config, deployerPrivateKey:string): Promise<Config> {
  validateRange(config.amm.initialAmplificationFactor, 0, 1000);
  validateRange(config.amm.finalAmplificationFactor, 0, 1000);
  validateRange(config.amm.swapFee, 0, 0.03);

  const maturityTimestamp = Date.parse(config.pool.maturity) / 1000;

  const ammConstructorArgs = [
    config.amm.lp.name,
    config.amm.lp.symbol,
    config.principal.address,
    config.yield.address,
    config.amm.initialAmplificationFactor * AMP_PRECISION,
    config.amm.finalAmplificationFactor * AMP_PRECISION,
    maturityTimestamp,
    parseDecimal(config.amm.swapFee, 18),
  ];

  const ybtSymbol = config.ybt.symbol;
  // Deploy AMM with a hardcoded 5.5M gas limit because otherwise gas estimation fails sometimes for some reason
  const tempusAmmContract = await confirmAndDeploy(
    "TempusAMM",
    network.name,
    `TempusAMM_${ybtSymbol}_maturity-${maturityTimestamp}`,
    ammConstructorArgs,
    deployerPrivateKey,
    5500000
  );

  config.amm.address = tempusAmmContract.address;
  return config;
}

async function deploy(configName:string) {
  let config:Config = JSON.parse(readFileSync(configName, 'utf-8').toString());

  console.log(config);

  const deployerPrivateKey = await utils.promptPrivateKey("Enter deployer Private Key");

  if (config.pool.address === undefined) {
    config = await deployPool(config, deployerPrivateKey);
  }

  if (config.amm.address === undefined) {
    config = await deployAmm(config, deployerPrivateKey);
  }

  writeFileSync(configName, JSON.stringify(config, null, 2));
}

deploy(process.env.TEMPUS_POOL_JSON);
