import { ethers } from 'hardhat';
import { ContractBase } from '../test/utils/ContractBase';

const stETHAddress = 

async function deployVault() {
    const owner = (await ethers.getSigners())[0];

    const authorizer = await ContractBase.deployContract("@balancer-labs/v2-vault/contracts/Authorizer.sol:Authorizer", owner.address);
    const vault = await ContractBase.deployContract("@balancer-labs/v2-vault/contracts/Vault.sol:Vault", authorizer.address, mockedWETH.address, 3 * MONTH, MONTH);
}
deployVault();
