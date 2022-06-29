import { ethers, getNamedAccounts, getUnnamedAccounts } from 'hardhat';
import { ERC20 } from "@tempus-labs/utils/ts/token/ERC20";
import { Decimal, decimal } from "@tempus-labs/utils/ts/utils/Decimal";
import { Signer } from '@tempus-labs/utils/ts/utils/ContractBase';

export class Balances
{
  constructor(
    public contract:ERC20,
    public signer1:Signer,
    public signer2:Signer,
    public balance1:Decimal,
    public balance2:Decimal) {
  }

  /** Gets and stores the current balances of Signer1 and Signer2 */
  public static async getBalances(contract:ERC20, signer1:Signer, signer2:Signer): Promise<Balances> {
    const balance1 = await contract.balanceOf(signer1);
    const balance2 = await contract.balanceOf(signer2);
    return new Balances(contract, signer1, signer2, balance1, balance2);
  }

  /**
   * Discrepancy between accrued interest from depositing directly
   * vs depositing via TempusPool
   */
  public async getInterestDeltaError(): Promise<Decimal> {
    const c:ERC20 = this.contract;
    const delta1 = (await c.balanceOf(this.signer1)).sub(this.balance1);
    const delta2 = (await c.balanceOf(this.signer2)).sub(this.balance2);
    // abs(1.0 - delta2/delta1)
    const error = decimal(1.0, c.decimals).sub( delta2.div(delta1) ).abs();
    return error;
  }
}

/**
 * Default Signer1 and Signer2
 */
export async function getDefaultSigners() {
  const [ account1, account2 ] = await getUnnamedAccounts();
  const signer1 = await ethers.getSigner(account1);
  const signer2 = await ethers.getSigner(account2);
  return { signer1, signer2 };
}

/**
 * Utility for getting signers and specific holders, reused in multiple tests
 */
export async function getAccounts(holderName?:string) {
  const owner = (await ethers.getSigners())[0];
  const holder = holderName ? await ethers.getSigner((await getNamedAccounts())[holderName]) : null;
  const { signer1, signer2 } = await getDefaultSigners();
  return { owner, holder: holder, signer1, signer2 };
}

/**
 * Maps account names into Signers
 */
export async function getNamedSigners(accounts:string[]): Promise<Signer[]> {
  const namedAccounts = await getNamedAccounts();
  const signers:Signer[] = [];
  for (const account of accounts) {
    const signer = await ethers.getSigner(namedAccounts[account]);
    signers.push(signer);
  }
  return signers;
}
