import { writeFile, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Contract } from '@ethersproject/contracts';
import { ethers } from 'hardhat';
import { FormatTypes } from 'ethers/lib/utils';
import * as prompts from "prompts";
import * as chalk from "chalk";

export async function generateDeployment(contract: Contract, contractName:string, networkName:string): Promise<void> {  
  const exportDir = join(__dirname, '../deployments/', networkName);
  if (!existsSync(exportDir)) {
    mkdirSync(exportDir);
  }

  const exportPath = join(exportDir, contractName + '.json');
  return new Promise((resolve, reject) => {
    writeFile(
      exportPath, 
      `${JSON.stringify(
        {
          address: contract.address,
          abi: JSON.parse(contract.interface.format(FormatTypes.json) as string)
        }, 
        null, 
        2
      )}`, 
      (error) => {
        if (error) {
          console.error('Failed to write deployment to disk!', error);
          reject(error);
        }
        else {
          console.log(`Exported deployment to: ${exportPath}`);
          resolve();
        }
    })
  });
}

export async function deployContract(contractName: string, constructorArgs: any[] = [], deployerPrivateKey?: string, gasLimit?: number) {
  const contractFactory = await ethers.getContractFactory(contractName, deployerPrivateKey ? new ethers.Wallet(deployerPrivateKey, ethers.provider) : undefined);
  return contractFactory.deploy(...constructorArgs, ...(gasLimit ? [{ gasLimit }] : []));
}

export async function getContract(networkName:string, contractName:string):Promise<Contract> {
  const deploymentPath = join(__dirname, '../deployments/', networkName, contractName + '.json');
  const deploymentJson = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
  return ethers.getContractAt(deploymentJson['abi'] as any[], deploymentJson['address']);
}

export async function getDeployedContractAddress(networkName:string, contractName:string): Promise<string> {
  const deploymentPath = join(__dirname, '../deployments/', networkName, contractName + '.json');
  if (!existsSync(deploymentPath)) return null;

  return JSON.parse(readFileSync(deploymentPath, 'utf-8')).address;
}

export async function promptAddress(message: string, defaultValue: string = null) {
  const validate = value => ethers.utils.isAddress(value) ? true : `Not a valid address`;
  return promptInput(message, defaultValue, validate);
}

export async function promptNumber(message: string, defaultValue: number = null, minValue: number = null, maxValue: number = null) {
  const validate = (value: number) => {
    if (minValue !== null && value < minValue) return `Must be greater or equal to ${minValue}`;
    if (maxValue !== null && value > maxValue) return `Must be smaller or equal to ${maxValue}`;
    return true;
  };

  return promptInput(message, defaultValue, validate);
}

export async function promptPrivateKey(message: string) {
  const validate = (value: string) => {
    let sanitizedValue = value;
    if (value.startsWith("0x")) sanitizedValue = value.substr(2);
    if (!sanitizedValue.match(/^[0-9a-f]*$/i) || sanitizedValue.length !== 64) return "Input is not a valid private key";
    return true;
  };

  return promptInput(message, null, validate, "password");
}

export async function promptInput(message: string, defaultValue: string|number = null, validate: (value: any) => boolean|string = null, type: string = "text") {
  const response = await prompts({
    type,
    name: 'value',
    message,
    ...(defaultValue ? { initial: defaultValue } : {}),
    ...(validate ? { validate } : {})
  });

  return response.value;
}

export async function toggleConfirm(message: string) : Promise<boolean> {
  const response = await prompts({
    type: 'toggle',
    name: 'value',
    message,
    initial: true,
    active: 'yes',
    inactive: 'no'
  });

  return response.value;
}

const wait = seconds => new Promise(res => setTimeout(res, seconds * 1000));
export async function waitForContractToBeDeployed(contractAddress: string): Promise<void> {
  while (true) {
    console.log(chalk.yellow(`Checking if contract ${contractAddress} is deployed yet...`));
    const contractCode = await ethers.provider.getCode(contractAddress);
    
    if (contractCode !== '0x0' && contractCode !== '0x') {
      console.log(chalk.green(`YES! ${contractAddress} was successfully deployed!`));
      await wait(15);
      break;
    }
    
    console.log(chalk.yellow("Contract not deployed yet, trying again in 5 seconds..."));
    await wait(5);
  }
}
