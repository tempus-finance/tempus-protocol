import { writeFile } from 'fs';
import { join } from 'path';
import { ethers } from 'hardhat';
import { Contract } from '@ethersproject/contracts';
import { ERC20 } from '../test/utils/ERC20';
import { generateTempusSharesNames, PoolType, TempusPool } from '../test/utils/TempusPool';
import { ContractBase, Signer } from '../test/utils/ContractBase';
import { TempusController } from '../test/utils/TempusController';
import { DAY, MONTH } from '../test/utils/TempusAMM';
import { toWei } from '../test/utils/Decimal';

export interface DeployedPoolInfo {
  address: string;
  principalShareAddress: string;
  yieldShareAddress: string;
  amm: string;
  backingToken: string;
  yieldBearingToken: string;
  backingTokenAddress: string;
  yieldBearingTokenAddress: string;
  protocol: PoolType;
  estimatedYield: number;
  spotPrice: string;
  maxLeftoverShares: string;
  decimalsForUI: number;
  maturityDate: number;
  startDate: number;
  poolId: string;
  tokenPrecision: {
    backingToken: number;
    yieldBearingToken: number;
    principals: number;
    yields: number;
    lpTokens: number;
  }
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
  spotPrice: string;
  maxLeftoverShares: string;
  poolId: string;
  protocol: string;
  startDate: number;
  maturityDate: number;
  principalsAddress: string;
  yieldsAddress: string;
  yieldBearingToken: string;
  yieldBearingTokenAddress: string;
  backingTokenAddress: string;
  decimalsForUI: number;
  tokenPrecision: {
    backingToken: number;
    yieldBearingToken: number;
    principals: number;
    yields: number;
    lpTokens: number;
  }
}

interface CookieConfigData {
  tempusPools: CookiePoolInfo[];
  statisticsContract: string;
  tempusControllerContract: string;
  vaultContract: string;
  networkUrl: string;
  lidoOracle: string;
  networkName: 'localhost';
}

interface DeployPoolParams {
  poolType: PoolType;
  owner: Signer;
  backingToken: string;
  bt: ERC20;
  ybt: ERC20;
  maturity: number;
  ybtName: string;
  ybtSymbol: string;
  yieldEstimate: number;
  lpName: string;
  lpSymbol: string;
  spotPrice: string;
  maxLeftoverShares: string;
  decimalsForUI: number;
  tokenPrecision: {
    backingToken: number;
    yieldBearingToken: number;
    principals: number;
    yields: number;
    lpTokens: number;
  }
  deploy: typeof TempusPool.deployAave | typeof TempusPool.deployCompound | typeof TempusPool.deployLido;
}

class DeployLocalForked {
  private readonly VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  private readonly LIDO_ORACLE_ADDRESS = '0x442af784a788a5bd6f42a01ebe9f287a871243fb';
  private readonly HOLDERS = {
    DAI: '0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0',
    aDAI: '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296',
    cDAI: '0x9b4772e59385ec732bccb06018e318b7b3477459',
    stETH: '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022'
  }

  private controller: TempusController;
  private stats: Contract;
  private owner: Signer;

  private deployedTempusPoolsInfo: DeployedPoolInfo[] = [];

  public async deploy() {
    this.owner = (await ethers.getSigners())[0];

    const Dai = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
    const Weth = new ERC20("ERC20", 18, (await ethers.getContract("Weth")));

    const aDaiToken = new ERC20("ERC20", 18, (await ethers.getContract('aToken_Dai')));
    const cDaiToken = new ERC20("ERC20", 8, (await ethers.getContract('cToken_Dai')));
    const stETHToken = new ERC20("ILido", 18, (await ethers.getContract('Lido')));
  
    const latestBlock = await ethers.provider.getBlock('latest');
    console.log(`Latest block number: ${latestBlock.number}`);

    const maturityTimeOneYear = latestBlock.timestamp + DAY * 365;
    const maturityTimeOneMonth = latestBlock.timestamp + MONTH;

    this.controller = await TempusController.deploy(this.owner);
    this.stats = await ContractBase.deployContract("Stats");

    console.log('Deploying Lido Pool - stETH - 1 month duration...');
    await this.deployPool({
      poolType: PoolType.Lido,
      owner: this.owner,
      backingToken: 'ETH',
      bt: Weth,
      ybt: stETHToken,
      maturity: maturityTimeOneMonth,
      yieldEstimate: 0.01,
      ybtName: 'Lido stETH',
      ybtSymbol: 'stETH',
      lpName: 'Tempus Lido LP Token - 1',
      lpSymbol: 'LPstETH - 1',
      spotPrice: '2',
      maxLeftoverShares: '0.00001',
      decimalsForUI: 4,
      tokenPrecision: {
        backingToken: 18,
        yieldBearingToken: 18,
        principals: 18,
        yields: 18,
        lpTokens: 18,
      },
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
      params.owner,
      params.bt,
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
      /*amplifyStart*/5,
      /*amplifyEnd*/95,
      toWei(0.002),
      3 * MONTH,
      MONTH,
      this.owner.address
    );

    await this.controller.register(this.owner, tempusAMM.address);

    this.deployedTempusPoolsInfo.push({
      address: pool.address,
      principalShareAddress: pool.principalShare.address,
      yieldShareAddress: pool.yieldShare.address,
      amm: tempusAMM.address,
      backingToken: params.backingToken,
      backingTokenAddress: '0x0000000000000000000000000000000000000000',
      yieldBearingTokenAddress: params.ybt.address,
      protocol: params.poolType,
      yieldBearingToken: params.ybtSymbol,
      estimatedYield: params.yieldEstimate,
      spotPrice: params.spotPrice,
      maxLeftoverShares: params.maxLeftoverShares,
      decimalsForUI: params.decimalsForUI,
      maturityDate: params.maturity,
      startDate: await pool.startTime() as number,
      poolId: await tempusAMM.getPoolId(),
      tokenPrecision: params.tokenPrecision,
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
            principalShareAddress: poolInfo.principalShareAddress,
            yieldShare: poolInfo.yieldShareAddress,
            amm: poolInfo.amm,
            backingToken: poolInfo.backingToken,
            protocol: poolInfo.protocol,
            yieldBearingToken: poolInfo.yieldBearingToken,
            estimatedYield: poolInfo.estimatedYield,
            spotPrice: poolInfo.spotPrice,
            maxLeftoverShares: poolInfo.maxLeftoverShares,
            backingTokenAddress: poolInfo.backingTokenAddress,
            yieldBearingTokenAddress: poolInfo.yieldBearingTokenAddress,
            decimalsForUI: poolInfo.decimalsForUI,
            maturityDate: poolInfo.maturityDate,
            startDate: poolInfo.startDate,
            poolId: poolInfo.poolId,
            yieldShareAddress: poolInfo.yieldShareAddress,
            tokenPrecision: poolInfo.tokenPrecision
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
          backingToken: deployedPoolInfo.backingToken,
          spotPrice: deployedPoolInfo.spotPrice,
          maxLeftoverShares: deployedPoolInfo.maxLeftoverShares,
          backingTokenAddress: deployedPoolInfo.backingTokenAddress,
          yieldBearingTokenAddress: deployedPoolInfo.yieldBearingTokenAddress,
          decimalsForUI: deployedPoolInfo.decimalsForUI,
          maturityDate: deployedPoolInfo.maturityDate * 1000, // Scale seconds to milliseconds
          startDate: deployedPoolInfo.startDate * 1000, // Scale seconds to milliseconds
          poolId: deployedPoolInfo.poolId,
          principalsAddress: deployedPoolInfo.principalShareAddress,
          protocol: deployedPoolInfo.protocol.toLowerCase(),
          yieldBearingToken: deployedPoolInfo.yieldBearingToken,
          yieldsAddress: deployedPoolInfo.yieldShareAddress,
          tokenPrecision: deployedPoolInfo.tokenPrecision
        }
      }),
      networkUrl: local ? 'http://127.0.0.1:8545' : 'https://network.tempus.finance',
      statisticsContract: this.stats.address,
      vaultContract: this.VAULT_ADDRESS,
      tempusControllerContract: this.controller.address,
      lidoOracle: this.LIDO_ORACLE_ADDRESS,
      networkName: 'localhost',
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
