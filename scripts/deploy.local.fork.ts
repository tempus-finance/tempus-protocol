import { writeFile } from 'fs';
import { join } from 'path';
import { ethers } from 'hardhat';
import { Contract } from '@ethersproject/contracts';
import { ERC20 } from '../test/utils/ERC20';
import { generateTempusSharesNames, PoolType, TempusPool } from '../test/utils/TempusPool';
import { ContractBase } from '../test/utils/ContractBase';
import { TempusController } from '../test/utils/TempusController';
import { DAY, MONTH } from '../test/utils/TempusAMM';
import { toWei } from '../test/utils/Decimal';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';

export interface DeployedPoolInfo {
  address: string;
  principalShare: string;
  yieldShare: string;
  amm: string;
  backingToken: string;
  yieldBearingToken: string;
  protocol: PoolType;
  estimatedYield: number;
}

interface DepositConfigData {
  addresses: {
    vault: string;
    tempusController: string;
    stats: string;
    tempusPools: DeployedPoolInfo[];
  },
  holders: {
    [key: string]: string;
  }
}

interface CookiePoolInfo {
  address: string;
  ammAddress: string;
  backingToken: string;
}

interface CookieConfigData {
  tempusPools: CookiePoolInfo[];
  statisticsContract: string;
  tempusControllerContract: string;
  vaultContract: string;
  networkUrl: string;
}

interface DeployPoolParams {
  poolType: PoolType;
  backingToken: string;
  ybt: ERC20;
  maturity: number;
  ybtName: string;
  ybtSymbol: string;
  yieldEstimate: number;
  lpName: string;
  lpSymbol: string;
  deploy: typeof TempusPool.deployAave | typeof TempusPool.deployCompound | typeof TempusPool.deployCompound;
}

class DeployLocalForked {
  private readonly VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  private readonly HOLDERS = {
    DAI: '0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0',
    aDAI: '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296',
    cDAI: '0x9b4772e59385ec732bccb06018e318b7b3477459',
    stETH: '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022'
  }

  private controller: TempusController;
  private stats: Contract;
  private owner: SignerWithAddress;

  private deployedTempusPoolsInfo: DeployedPoolInfo[] = [];

  public async deploy() {
    this.owner = (await ethers.getSigners())[0];

    const aDaiToken = new ERC20("ERC20", (await ethers.getContract('aToken_Dai')));
    const cDaiToken = new ERC20("ERC20", (await ethers.getContract('cToken_Dai')));
    const stETHToken = new ERC20("ILido", (await ethers.getContract('Lido')));
  
    const latestBlock = await ethers.provider.getBlock('latest');
    console.log(`Latest block number: ${latestBlock.number}`);

    const maturityTimeOneYear = latestBlock.timestamp + DAY * 365;
    const maturityTimeOneMonth = latestBlock.timestamp + MONTH;

    this.controller = await TempusController.deploy();
    this.stats = await ContractBase.deployContract("Stats");

    console.log('Deploying Aave Pool - aDAI - 1 year duration...');
    await this.deployPool({
      poolType: PoolType.Aave,
      backingToken: 'DAI',
      ybt: aDaiToken,
      maturity: maturityTimeOneYear,
      yieldEstimate: 0.1,
      ybtName: 'aDai Aave Token',
      ybtSymbol: 'aDai',
      lpName: 'Tempus Aave LP Token',
      lpSymbol: 'LPaDAI',
      deploy: TempusPool.deployAave
    });

    console.log('Deploying Aave Pool - aDAI - 1 month duration...');
    await this.deployPool({
      poolType: PoolType.Aave,
      backingToken: 'DAI',
      ybt: aDaiToken,
      maturity: maturityTimeOneMonth,
      yieldEstimate: 0.01,
      ybtName: 'aDai Aave Token',
      ybtSymbol: 'aDai',
      lpName: 'Tempus Aave LP Token - 1',
      lpSymbol: 'LPaDAI - 1',
      deploy: TempusPool.deployAave
    });

    /*console.log('Deploying Compound Pool - cDAI - 1 year duration...');
    await this.deployPool({
      poolType: PoolType.Compound,
      backingToken: 'DAI',
      ybt: cDaiToken,
      maturity: maturityTimeOneYear,
      yieldEstimate: 0.13,
      ybtName: 'cDai Compound Token',
      ybtSymbol: 'cDai',
      lpName: 'Tempus Compound LP Token',
      lpSymbol: 'LPcDAI',
      deploy: TempusPool.deployCompound
    });

    console.log('Deploying Compound Pool - cDAI - 1 month duration...');
    await this.deployPool({
      poolType: PoolType.Compound,
      backingToken: 'DAI',
      ybt: cDaiToken,
      maturity: maturityTimeOneMonth,
      yieldEstimate: 0.011,
      ybtName: 'cDai Compound Token',
      ybtSymbol: 'cDai',
      lpName: 'Tempus Compound LP Token - 1',
      lpSymbol: 'LPcDAI - 1',
      deploy: TempusPool.deployCompound
    });*/

    console.log('Deploying Lido Pool - stETH - 1 year duration...');
    await this.deployPool({
      poolType: PoolType.Lido,
      backingToken: 'ETH',
      ybt: stETHToken,
      maturity: maturityTimeOneYear,
      yieldEstimate: 0.1,
      ybtName: 'Lido stETH',
      ybtSymbol: 'stETH',
      lpName: 'Tempus Lido LP Token',
      lpSymbol: 'LPstETH',
      deploy: TempusPool.deployLido
    });

    console.log('Deploying Lido Pool - stETH - 1 month duration...');
    await this.deployPool({
      poolType: PoolType.Lido,
      backingToken: 'ETH',
      ybt: stETHToken,
      maturity: maturityTimeOneMonth,
      yieldEstimate: 0.01,
      ybtName: 'Lido stETH',
      ybtSymbol: 'stETH',
      lpName: 'Tempus Lido LP Token - 1',
      lpSymbol: 'LPstETH - 1',
      deploy: TempusPool.deployLido
    });

    console.log('Exporting deposit config...');
    await this.generateDepositConfig();

    console.log('Generating AWS Cookie Config for frontend...');
    this.generateCookieBookmark(false);

    console.log('Generating LOCAL Cookie Config for frontend...');
    this.generateCookieBookmark(true);
  }

  private async deployPool(params: DeployPoolParams) {
    const pool = await params.deploy(
      params.ybt,
      this.controller,
      params.maturity,
      params.yieldEstimate,
      generateTempusSharesNames(params.ybtName, params.ybtSymbol, params.maturity)
    );

    let tempusAMM = await ContractBase.deployContract(
      "TempusAMM",
      this.VAULT_ADDRESS,
      params.lpName,
      params.lpSymbol,
      pool.address,
      5,
      toWei(0.002),
      3 * MONTH,
      MONTH,
      this.owner.address
    );
    this.deployedTempusPoolsInfo.push({
      address: pool.address,
      principalShare: pool.principalShare.address,
      yieldShare: pool.yieldShare.address,
      amm: tempusAMM.address,
      backingToken: params.backingToken,
      protocol: params.poolType,
      yieldBearingToken: params.ybtSymbol,
      estimatedYield: params.yieldEstimate
    });
  }

  private async generateDepositConfig(): Promise<void> {
    const depositConfig: DepositConfigData = {
      addresses: {
        tempusController: this.controller.address,
        vault: this.VAULT_ADDRESS,
        stats: this.stats.address,
        tempusPools: this.deployedTempusPoolsInfo.map((poolInfo) => {
          return {
            address: poolInfo.address,
            principalShare: poolInfo.principalShare,
            yieldShare: poolInfo.yieldShare,
            amm: poolInfo.amm,
            backingToken: poolInfo.backingToken,
            protocol: poolInfo.protocol,
            yieldBearingToken: poolInfo.yieldBearingToken,
            estimatedYield: poolInfo.estimatedYield
          }
        })
      },
      holders: this.HOLDERS
    };

    const exportPath = join(__dirname, '../deposit.local.config.ts');
    return new Promise((resolve, reject) => {
      writeFile(exportPath, `export default ${JSON.stringify(depositConfig, null, 2)}`, (error) => {
        if (error) {
          console.error('Failed to write deposit config to disk!', error);
          reject(error);
        }
        else {
          console.log(`Exported deposit config to: ${exportPath}`);
          resolve();
        }
      })
    });
  }

  private generateCookieBookmark(local: boolean) {
    const cookieConfig: CookieConfigData = {
      tempusPools: this.deployedTempusPoolsInfo.map((deployedPoolInfo) => {
        return {
          address: deployedPoolInfo.address,
          ammAddress: deployedPoolInfo.amm,
          backingToken: deployedPoolInfo.backingToken
        }
      }),
      networkUrl: local ? 'http://127.0.0.1:8545' : 'https://network.tempus.finance',
      statisticsContract: this.stats.address,
      vaultContract: this.VAULT_ADDRESS,
      tempusControllerContract: this.controller.address
    }

    const cookieValue = encodeURIComponent(JSON.stringify(cookieConfig));

    // Log bookmark URL value for cookie generation
    console.log(
      'javascript:(function() {' +
        `document.cookie = "TEMPUS_OVERRIDING_CONFIG=${encodeURIComponent(cookieValue)};path=${encodeURIComponent('/')};expires=${new Date(Date.now() + MONTH * 1000).toUTCString()}";` +
      '})()'
    );
  }
}
const deployLocalForked = new DeployLocalForked();
deployLocalForked.deploy();
