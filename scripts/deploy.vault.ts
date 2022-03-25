import { network } from 'hardhat';
import * as utils from './utils';

const MONTH = 60 * 60 * 24 * 30;
const AUTHORIZER_FULLY_QUALIFIED_PATH = "@balancer-labs/v2-vault/contracts/Authorizer.sol:Authorizer";
const VAULT_FULLY_QUALIFIED_PATH = "@balancer-labs/v2-vault/contracts/Vault.sol:Vault";

async function deploy() {
  const deployerPrivateKey = await utils.promptPrivateKey("Enter deployer Private Key");

  const authorizerAdmin = await utils.promptAddress("Enter the address of the Authorizer Admin");
  const weth = await utils.promptAddress("Enter the address of the WETH contract");
  
  const authorizerContract = await utils.deployContract(AUTHORIZER_FULLY_QUALIFIED_PATH, [authorizerAdmin], deployerPrivateKey);  
  await utils.waitForContractToBeDeployed(authorizerContract.address);
  
  const vaultContract = await utils.deployContract(VAULT_FULLY_QUALIFIED_PATH, [authorizerContract.address, weth, 3 * MONTH, MONTH], deployerPrivateKey);
  await utils.waitForContractToBeDeployed(vaultContract.address);
  
  await utils.generateDeployment(authorizerContract, `TempusAMMVaultAuthorizer`, network.name);
  await utils.generateDeployment(vaultContract, `TempusAMMVault`, network.name);
}

deploy();
