import { ethers } from 'hardhat';

const SECONDS_IN_A_DAY = 86400;

async function main() {
  const [owner] = await ethers.getSigners();

  const adaiTokenContract = await ethers.getContract('aToken_Dai');

  const latestBlock = await ethers.provider.getBlock('latest');
  console.log(`Latest block number: ${latestBlock.number}`);

  // Deploy Aave price oracle contract
  const aavePriceOracleFactory = await ethers.getContractFactory('AavePriceOracle', owner);
  const aavePriceOracle = await aavePriceOracleFactory.deploy();

  // Deploy Tempus pool backed by Aave (aDAI Token)
  const tempusPoolFactory = await ethers.getContractFactory('TempusPool', owner);
  const tempusPool = await tempusPoolFactory.deploy(adaiTokenContract.address, aavePriceOracle.address, latestBlock.timestamp + SECONDS_IN_A_DAY * 365);

  // Log required information to console.
  console.log(`Deployed TempusPool contract at: ${tempusPool.address}`);
  console.log(`TPS deployed at: ${await tempusPool.principalShare()}`)
  console.log(`TYS deployed at: ${await tempusPool.yieldShare()}`);
  console.log(`YBT address: ${await tempusPool.yieldBearingToken()}`);
}
main();
