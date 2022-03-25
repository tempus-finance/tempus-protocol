import { expect, AssertionError } from 'chai';
import { AsyncFunc } from 'mocha';
import { Contract } from 'ethers';
import { ContractBase } from "../utils/ContractBase";
import { BigNumberish, fp, num, isBigNumberish } from './Numbers';
import { Decimal } from 'decimal.js';
import { describeNonPool } from '../pool-utils/MultiPoolTestSuite';
import {
  amp,
  calculateAnalyticalInvariantForTwoTokens,
  calculateInvariant,
  calcInGivenOut,
  calcOutGivenIn,
  calcBptOutGivenExactTokensIn,
  calcBptInGivenExactTokensOut,
  calcTokenOutGivenExactBptIn,
  calcTokensOutGivenExactBptIn,
  calculateOneTokenSwapFeeAmount,
  getTokenBalance
} from './StableMath';

function expectEqual(expected:BigNumberish|Decimal, actual:BigNumberish|Decimal) {
  const _actual = num(expected);
  const _expected = num(actual);
  const maxErr = _expected * 0.001;
  //console.log('actual=%s expected=%s\n', _actual, _expected);
  expect(_actual).to.be.within(_expected - maxErr, _expected + maxErr);
}

async function expectEquals(fun1:AsyncFunc, fun2:Function, ...args:any[]): Promise<void> {
  //console.log("%s(%s)", fun2.name, args.toString());
  const actual = await fun1.apply(null, args);
  const expected = fun2.apply(null, args);
  try {
    if (isBigNumberish(actual)) {
      expectEqual(actual, expected);
    } else {
      const actualArr = Object.keys(actual).map(key => actual[key]);
      const expectArr = Object.keys(expected).map(key => expected[key]);
      if (actualArr.length !== expectArr.length) {
        throw new Error("Array length mismatch:"+actualArr.toString()+" != "+expectArr.toString());
      }
      for (let i = 0; i < actualArr.length; ++i) {
        expectEqual(actualArr[i], expectArr[i]);
      }
    }
  } catch (e) {
    if (e instanceof AssertionError) {
      throw new AssertionError(e.message + " in " + fun2.name + " with args ("+args+")");
    }
  }
}

describeNonPool('StableMath', () =>
{
  let mockMath:Contract;

  before(async () => {
    mockMath = await ContractBase.deployContract("MockStableMath");
  });

  it('invariant', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.invariant, calculateInvariant, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(12)], true);
    await equal(amp(100), /*balances*/[fp(10), fp(10)], true);
    await equal(amp(100), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(100), /*balances*/[fp(100), fp(100)], true);

    await equal(amp(1), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], true);
  });

  it('invariant equals analytical solution', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.invariant, calculateAnalyticalInvariantForTwoTokens, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(12)], true);

    await equal(amp(1), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], true);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], true);
  });

  it('invariant reverts if it does not converge', async () =>
  {
    await expect(mockMath.invariant(amp(50000), [fp(1.777777777777), fp(18181818181818181818)], true))
          .to.be.revertedWith('StableMath no convergence');
  });

  // Computes how many IN tokens must be sent to a pool if `tokenAmountOut` are received, given the current balances
  it('inGivenOut', async () =>
  {
    const inGivenOut = (...args:any[]) => expectEquals(mockMath.inGivenOut, calcInGivenOut, ...args);

    await inGivenOut(amp(100), /*balances*/[fp(10), fp(12)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(1));
    await inGivenOut(amp(1), /*balances*/[fp(100), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(10));

    // balances are not close enough, and then we want them to diverge even more.
    await inGivenOut(amp(1),  /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountOut*/fp(5));
    await inGivenOut(amp(5),  /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountOut*/fp(5));
    await inGivenOut(amp(10), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountOut*/fp(5));
    await inGivenOut(amp(20), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountOut*/fp(5));
    await inGivenOut(amp(50), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountOut*/fp(5));
    await inGivenOut(amp(90), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountOut*/fp(5));

    // adding more "balanced" swap by adding token which has less balance
    await inGivenOut(amp(1),  /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(50));
    await inGivenOut(amp(5),  /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(50));
    await inGivenOut(amp(10), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(50));
    await inGivenOut(amp(20), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(50));
    await inGivenOut(amp(50), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(50));
    await inGivenOut(amp(90), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountOut*/fp(50));
  });

  it('outGivenIn', async () =>
  {
    const outGivenIn = (...args:any[]) => expectEquals(mockMath.outGivenIn, calcOutGivenIn, ...args);
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(11)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(1));
    await outGivenIn(amp(1), /*balances*/[fp(100), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(10));

    // balances are not close enough, and then we want them to diverge even more.
    await outGivenIn(amp(1),  /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountIn*/fp(50));
    await outGivenIn(amp(5),  /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountIn*/fp(50));
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountIn*/fp(50));
    await outGivenIn(amp(20), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountIn*/fp(50));
    await outGivenIn(amp(50), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountIn*/fp(50));
    await outGivenIn(amp(90), /*balances*/[fp(10), fp(100)], /*indexIn*/1, /*indexOut*/0, /*tokenAmountIn*/fp(50));

    // adding more "balanced" swap by adding token which has less balance
    await outGivenIn(amp(1),  /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(5));
    await outGivenIn(amp(5),  /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(5));
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(5));
    await outGivenIn(amp(20), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(5));
    await outGivenIn(amp(50), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(5));
    await outGivenIn(amp(90), /*balances*/[fp(10), fp(100)], /*indexIn*/0, /*indexOut*/1, /*tokenAmountIn*/fp(5));
  });

  it('bptOutGivenExactTokensIn', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.bptOutGivenExactTokensIn, calcBptOutGivenExactTokensIn, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));

    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(1)], fp(10000), fp(0.1));
  });

  it('bptInGivenExactTokensOut', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.bptInGivenExactTokensOut, calcBptInGivenExactTokensOut, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));

    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(1)], fp(10000), fp(0.1));
  });

  it('tokenOutGivenExactBptIn', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.tokenOutGivenExactBptIn, calcTokenOutGivenExactBptIn, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));

    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*tokenIndex*/0, fp(100), fp(10000), fp(0.1));
  });

  it('tokensOutGivenExactBptIn', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.tokensOutGivenExactBptIn, calcTokensOutGivenExactBptIn, ...args);
    await equal(/*balances*/[fp(10), fp(11)], /*bptAmountIn*/fp(100), /*bptTotalSupply*/fp(100));
    await equal(/*balances*/[fp(10), fp(100)], /*bptAmountIn*/fp(100), /*bptTotalSupply*/fp(100));
  });

  it('dueTokenProtocolSwapFeeAmount', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.dueTokenProtocolSwapFeeAmount, calculateOneTokenSwapFeeAmount, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));

    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*lastInvariant*/fp(10), /*tokenIndex*/0, fp(0.1));
  });

  it('tokenBalanceGivenInvariantAndAllOtherBalances', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.getTokenBalance, getTokenBalance, ...args);
    
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*invariant:*/fp(21), /*tokenIndex*/0);
    await equal(amp(100), /*balances*/[fp(10), fp(10)], /*invariant:*/fp(20), /*tokenIndex*/0);
    await equal(amp(100), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(110), /*tokenIndex*/0);

    await equal(amp(1), /*balances*/[fp(10), fp(10)], /*invariant:*/fp(20), /*tokenIndex*/0);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(110), /*tokenIndex*/0);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*tokenIndex*/0);

    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*tokenIndex*/0);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*tokenIndex*/0);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*tokenIndex*/0);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*tokenIndex*/0);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*tokenIndex*/0);
  });
});
