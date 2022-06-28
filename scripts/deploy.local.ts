import { blockTimestamp } from "@tempus-labs/utils/ts/utils/Utils";
import { Aave } from "../test/protocols/Aave";
import { generateTempusSharesNames, TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { TokenInfo } from "../test/pool-utils/TokenInfo";
import { ethers } from 'hardhat';

const ASSET:TokenInfo = { decimals:18, name:"Dai Stablecoin", symbol:"DAI", totalSupply:1000000 };
const YIELD:TokenInfo = { decimals:18, name:"Aave interest bearing DAI", symbol:"aDAI" };

async function deployAavePool(initialLiquidityIndex: number): Promise<Aave> {
  const aave:Aave = await Aave.create(ASSET, YIELD, initialLiquidityIndex);
  console.log('Aave pool deployed to: ', aave.address);
  console.log('Backing token deployed to: ', aave.asset.address);
  console.log('YBT deployed to: ', aave.yieldToken.address);
  return aave;
}

async function deployATokenTempusPool(aave: Aave, poolDurationSeconds: number) {
  const owner = (await ethers.getSigners())[0];

  const maturityTime = await blockTimestamp() + poolDurationSeconds;
  const names = generateTempusSharesNames(YIELD.name, YIELD.symbol, maturityTime);
  const yieldEst = 0.1;

  const controller = await TempusController.deploy(owner);
  const pool = await TempusPool.deployAave(
    owner, aave.asset, aave.yieldToken, controller, maturityTime, yieldEst, names
  );

  console.log('AToken TempusPool deployed with length %i sec to: %s', poolDurationSeconds, pool.address);
}

async function main() {
  // deploy multiple aave pools
  const aave:Aave = await deployAavePool(100);
  // deploy one month pool
  await deployATokenTempusPool(aave, 60*60*24*30);
  // deploy one year pool
  await deployATokenTempusPool(aave, 60*60*24*365);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
