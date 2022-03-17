import { expect } from 'chai';
import { AsyncFunc } from 'mocha';
import { Contract } from 'ethers';
import { ContractBase } from "../utils/ContractBase";
import { BigNumberish, bn, fp, num } from './Numbers';
import { Decimal } from 'decimal.js';
import {
  calculateAnalyticalInvariantForTwoTokens,
  calculateInvariant,
  calcInGivenOut,
  calcOutGivenIn,
  calcBptOutGivenExactTokensIn,
  calcTokenInGivenExactBptOut,
  calcBptInGivenExactTokensOut,
  calcTokenOutGivenExactBptIn,
  calculateOneTokenSwapFeeAmount,
} from './StableMath';

function expectEqual(actual:BigNumberish|Decimal, expected:BigNumberish|Decimal, error:number = 0.001) {
  const _actual = num(actual);
  const _expected = num(expected);
  const maxErr = _expected * error;
  expect(_actual).to.be.within(_expected - maxErr, _expected + maxErr);
  console.log('OK actual=%s expected=%s', _actual, _expected);
}

async function expectEquals(fun1:AsyncFunc, fun2:Function, ...args:any[]) {
  const result = await fun1.apply(null, args);
  const expected = fun2.apply(null, args);
  expectEqual(result, expected);
}

describe.only('StableMath', () =>
{
  let mock:Contract;
  const getAmp = (amp:number) => bn(amp).mul(1e3);

  before(async () =>
  {
    mock = await ContractBase.deployContract("MockStableMath");
  });

  it('invariant', async () =>
  {
    const balances = [fp(10), fp(12)];
    const result = await mock.invariant(getAmp(100), balances, true);
    const expected = calculateInvariant(bn(100), balances, true);
    expectEqual(result, expected);

    expectEquals(mock.invariant, calculateInvariant, getAmp(100), balances, true);
  });

  it('invariant equals analytical solution', async () =>
  {
    const balances = [fp(10), fp(12)];
    const result = await mock.invariant(getAmp(100), balances, true);
    const expected = calculateAnalyticalInvariantForTwoTokens(balances, bn(100));
    expectEqual(result, expected);
  });

  it('invariant reverts if it does not converge', async () =>
  {
    const balances = [fp(0.00001), fp(1200000), fp(300)];
    await expect(mock.invariant(getAmp(5000), balances, true)).to.be.revertedWith(
        'StableMath no convergence'
    );
  });

  it('inGivenOut', async () =>
  {
    const balances = [fp(10), fp(12)];
    const result = await mock.inGivenOut(getAmp(100), balances, 0, 1, fp(1));
    const expected = calcInGivenOut(bn(100), balances, 0, 1, fp(1));
    expectEqual(result, expected);
  });

  it('outGivenIn', async () =>
  {
    const balances = [fp(10), fp(11)];
    const result = await mock.outGivenIn(getAmp(10), balances, 0, 1, fp(1));
    const expected = calcOutGivenIn(bn(10), balances, 0, 1, fp(1));
    expectEqual(result, expected);
  });

  it('bptOutGivenExactTokensIn', async () =>
  {
    const balances = [fp(10), fp(11)];
    const amountsIn = [fp(1), fp(1)];
    const result = await mock.bptOutGivenExactTokensIn(
      getAmp(100), balances, amountsIn, fp(10000), fp(0.1)
    );
    const expected = calcBptOutGivenExactTokensIn(
      bn(100), balances, amountsIn, fp(10000), fp(0.1)
    );
    expectEqual(result, expected);
  });

  it('tokenInGivenExactBptOut', async () =>
  {
    const balances = [fp(10), fp(11)];
    const result = await mock.tokenInGivenExactBptOut(
      getAmp(100), balances, 0, /*bptOut*/fp(100), fp(10000), fp(0.1)
    );
    const expected = calcTokenInGivenExactBptOut(
      bn(100), balances, 0, /*bptOut*/fp(100), fp(10000), fp(0.1)
    );
    expectEqual(result, expected);
  });

  it('bptInGivenExactTokensOut', async () =>
  {
    const balances = [fp(10), fp(11)];
    const amountsOut = [fp(1), fp(1)];
    const result = await mock.bptInGivenExactTokensOut(
      getAmp(100), balances, amountsOut, fp(10000), fp(0.1)
    );
    const expected = calcBptInGivenExactTokensOut(
      bn(100), balances, amountsOut, fp(10000), fp(0.1)
    );
    expectEqual(result, expected);
  });

  it('tokenOutGivenExactBptIn', async () =>
  {
    const balances = [fp(10), fp(11)];
    const result = await mock.tokenOutGivenExactBptIn(
      getAmp(100), balances, 0, fp(100), fp(10000), fp(0.1)
    );
    const expected = calcTokenOutGivenExactBptIn(
      bn(100), balances, 0, fp(100), fp(10000), fp(0.1)
    );
    expectEqual(result, expected);
  });

  it('dueTokenProtocolSwapFeeAmount returns protocol swap fees', async () =>
  {
    const balances = [fp(10), fp(11)];
    const lastInvariant = fp(10);
    const result = await mock.dueTokenProtocolSwapFeeAmount(
      getAmp(100), balances, lastInvariant, 0, fp(0.1)
    );
    const expected = calculateOneTokenSwapFeeAmount(
      bn(100), balances, lastInvariant, 0, fp(0.1)
    );
    expectEqual(result, expected);
  });
});
