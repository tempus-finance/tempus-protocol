import { expect, AssertionError } from 'chai';
import { AsyncFunc } from 'mocha';
import { Contract } from 'ethers';
import { ContractBase } from "../utils/ContractBase";
import { expectRevert } from "../utils/Utils";
import { BigNumberish, fp, num, isBigNumberish } from './Numbers';
import { Decimal } from 'decimal.js';
import { describeNonPool } from '../pool-utils/MultiPoolTestSuite';
import {
  amp,
  analyticalInvariantForTwoTokens,
  calculateInvariant,
  calcOutGivenIn,
  calcInGivenOut,
  lpOutGivenTokensIn,
  lpInGivenTokensOut,
  tokenOutFromLPIn,
  tokensOutFromLPIn,
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

    await equal(amp(100), /*balances*/[fp(0), fp(0)], /*roundUp*/true);
    await equal(amp(100), /*balances*/[fp(10), fp(12)], /*roundUp*/true);
    await equal(amp(100), /*balances*/[fp(10), fp(10)], /*roundUp*/true);
    await equal(amp(100), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(100), /*balances*/[fp(100), fp(100)], /*roundUp*/true);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*roundUp*/true);

    await equal(amp(100), /*balances*/[fp(0), fp(0)], /*roundUp*/false);
    await equal(amp(100), /*balances*/[fp(10), fp(12)], /*roundUp*/false);
    await equal(amp(100), /*balances*/[fp(10), fp(10)], /*roundUp*/false);
    await equal(amp(100), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(100), /*balances*/[fp(100), fp(100)], /*roundUp*/false);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
  });

  it('invariant equals analytical solution', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.invariant, analyticalInvariantForTwoTokens, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(12)], /*roundUp*/true);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*roundUp*/true);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*roundUp*/true);

    await equal(amp(100), /*balances*/[fp(10), fp(12)], /*roundUp*/false);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*roundUp*/false);
  });

  it('invariant reverts if it does not converge', async () =>
  {
    (await expectRevert(mockMath.invariant(amp(50000), [fp(1.777777777777), fp(18181818181818181818)], true)))
          .to.equal(':StableMathNoConvergence');
  });

  it('outGivenIn', async () =>
  {
    const outGivenIn = (...args:any[]) => expectEquals(mockMath.outGivenIn, calcOutGivenIn, ...args);
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(11)],  /*firstIn*/true,  /*amountIn*/fp(1));
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(11)],  /*firstIn*/false, /*amountIn*/fp(1));
    await outGivenIn(amp(1), /*balances*/[fp(100), fp(100)], /*firstIn*/true,  /*amountIn*/fp(10));
    await outGivenIn(amp(1), /*balances*/[fp(100), fp(100)], /*firstIn*/false, /*amountIn*/fp(10));

    // balances are not close enough, and then we want them to diverge even more.
    await outGivenIn(amp(1),  /*balances*/[fp(10), fp(100)], /*firstIn*/false, /*amountIn*/fp(50));
    await outGivenIn(amp(5),  /*balances*/[fp(10), fp(100)], /*firstIn*/false, /*amountIn*/fp(50));
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(100)], /*firstIn*/false, /*amountIn*/fp(50));
    await outGivenIn(amp(20), /*balances*/[fp(10), fp(100)], /*firstIn*/false, /*amountIn*/fp(50));
    await outGivenIn(amp(50), /*balances*/[fp(10), fp(100)], /*firstIn*/false, /*amountIn*/fp(50));
    await outGivenIn(amp(90), /*balances*/[fp(10), fp(100)], /*firstIn*/false, /*amountIn*/fp(50));

    // adding more "balanced" swap by adding token which has less balance
    await outGivenIn(amp(1),  /*balances*/[fp(10), fp(100)], /*firstIn*/true, /*amountIn*/fp(5));
    await outGivenIn(amp(5),  /*balances*/[fp(10), fp(100)], /*firstIn*/true, /*amountIn*/fp(5));
    await outGivenIn(amp(10), /*balances*/[fp(10), fp(100)], /*firstIn*/true, /*amountIn*/fp(5));
    await outGivenIn(amp(20), /*balances*/[fp(10), fp(100)], /*firstIn*/true, /*amountIn*/fp(5));
    await outGivenIn(amp(50), /*balances*/[fp(10), fp(100)], /*firstIn*/true, /*amountIn*/fp(5));
    await outGivenIn(amp(90), /*balances*/[fp(10), fp(100)], /*firstIn*/true, /*amountIn*/fp(5));
  });

  // Computes how many IN tokens must be sent to a pool if `amountOut` are received, given the current balances
  it('inGivenOut', async () =>
  {
    const inGivenOut = (...args:any[]) => expectEquals(mockMath.inGivenOut, calcInGivenOut, ...args);

    await inGivenOut(amp(100), /*balances*/[fp(10), fp(12)], /*firstOut*/true,  /*amountOut*/fp(1));
    await inGivenOut(amp(100), /*balances*/[fp(10), fp(12)], /*firstOut*/false, /*amountOut*/fp(1));
    await inGivenOut(amp(1), /*balances*/[fp(100), fp(100)], /*firstOut*/true,  /*amountOut*/fp(10));
    await inGivenOut(amp(1), /*balances*/[fp(100), fp(100)], /*firstOut*/false, /*amountOut*/fp(10));

    // balances are not close enough, and then we want them to diverge even more.
    await inGivenOut(amp(1),  /*balances*/[fp(10), fp(100)], /*firstOut*/true, /*amountOut*/fp(5));
    await inGivenOut(amp(5),  /*balances*/[fp(10), fp(100)], /*firstOut*/true, /*amountOut*/fp(5));
    await inGivenOut(amp(10), /*balances*/[fp(10), fp(100)], /*firstOut*/true, /*amountOut*/fp(5));
    await inGivenOut(amp(20), /*balances*/[fp(10), fp(100)], /*firstOut*/true, /*amountOut*/fp(5));
    await inGivenOut(amp(50), /*balances*/[fp(10), fp(100)], /*firstOut*/true, /*amountOut*/fp(5));
    await inGivenOut(amp(90), /*balances*/[fp(10), fp(100)], /*firstOut*/true, /*amountOut*/fp(5));

    // adding more "balanced" swap by adding token which has less balance
    await inGivenOut(amp(1),  /*balances*/[fp(10), fp(100)], /*firstOut*/false, /*amountOut*/fp(50));
    await inGivenOut(amp(5),  /*balances*/[fp(10), fp(100)], /*firstOut*/false, /*amountOut*/fp(50));
    await inGivenOut(amp(10), /*balances*/[fp(10), fp(100)], /*firstOut*/false, /*amountOut*/fp(50));
    await inGivenOut(amp(20), /*balances*/[fp(10), fp(100)], /*firstOut*/false, /*amountOut*/fp(50));
    await inGivenOut(amp(50), /*balances*/[fp(10), fp(100)], /*firstOut*/false, /*amountOut*/fp(50));
    await inGivenOut(amp(90), /*balances*/[fp(10), fp(100)], /*firstOut*/false, /*amountOut*/fp(50));
  });

  it('lpOutGivenTokensIn', async () =>
  {
    const lpSupply = fp(10000);
    const swapFee = fp(0.1);
    const equal = (...args:any[]) => expectEquals(mockMath.lpOutGivenTokensIn, lpOutGivenTokensIn, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);

    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);

    await equal(amp(1), /*balances*/[fp(100), fp(10)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(5), /*balances*/[fp(100), fp(10)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(100), fp(10)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(100), fp(10)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(100), fp(10)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(100), fp(10)], /*amountsIn*/[fp(1), fp(2)], lpSupply, swapFee);
  });

  it('lpInGivenTokensOut', async () =>
  {
    const lpSupply = fp(10000);
    const swapFee = fp(0.1);
    const equal = (...args:any[]) => expectEquals(mockMath.lpInGivenTokensOut, lpInGivenTokensOut, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);

    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);

    await equal(amp(1), /*balances*/[fp(100), fp(10)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(5), /*balances*/[fp(100), fp(10)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(100), fp(10)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(100), fp(10)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(100), fp(10)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(100), fp(10)], /*amountsOut*/[fp(1), fp(2)], lpSupply, swapFee);
  });

  it('tokenOutFromLPIn', async () =>
  {
    const lpSupply = fp(10000);
    const swapFee = fp(0.1);
    const equal = (...args:any[]) => expectEquals(mockMath.tokenOutFromLPIn, tokenOutFromLPIn, ...args);
    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);

    await equal(amp(1),  /*balances*/[fp(10), fp(100)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(5),  /*balances*/[fp(10), fp(100)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*firstToken*/true, /*lpIn*/fp(100), lpSupply, swapFee);
    
    await equal(amp(1),  /*balances*/[fp(100), fp(10)], /*firstToken*/true, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(5),  /*balances*/[fp(100), fp(10)], /*firstToken*/true, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(100), fp(10)], /*firstToken*/true, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(100), fp(10)], /*firstToken*/true, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(100), fp(10)], /*firstToken*/true, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(100), fp(10)], /*firstToken*/true, /*lpIn*/fp(50), lpSupply, swapFee);

    await equal(amp(1),  /*balances*/[fp(10), fp(100)], /*firstToken*/false, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(5),  /*balances*/[fp(10), fp(100)], /*firstToken*/false, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*firstToken*/false, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*firstToken*/false, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*firstToken*/false, /*lpIn*/fp(100), lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*firstToken*/false, /*lpIn*/fp(100), lpSupply, swapFee);
    
    await equal(amp(1),  /*balances*/[fp(100), fp(10)], /*firstToken*/false, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(5),  /*balances*/[fp(100), fp(10)], /*firstToken*/false, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(10), /*balances*/[fp(100), fp(10)], /*firstToken*/false, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(20), /*balances*/[fp(100), fp(10)], /*firstToken*/false, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(50), /*balances*/[fp(100), fp(10)], /*firstToken*/false, /*lpIn*/fp(50), lpSupply, swapFee);
    await equal(amp(90), /*balances*/[fp(100), fp(10)], /*firstToken*/false, /*lpIn*/fp(50), lpSupply, swapFee);
  });

  it('tokensOutFromLPIn', async () =>
  {
    const lpSupply = fp(10000);
    const equal = (...args:any[]) => expectEquals(mockMath.tokensOutFromLPIn, tokensOutFromLPIn, ...args);
    await equal(/*balances*/[fp(10), fp(11)], /*lpAmountIn*/fp(100), lpSupply);

    await equal(/*balances*/[fp(10), fp(100)], /*lpAmountIn*/fp(100), lpSupply);
    await equal(/*balances*/[fp(100), fp(10)], /*lpAmountIn*/fp(100), lpSupply);
    await equal(/*balances*/[fp(0), fp(100)], /*lpAmountIn*/fp(100), lpSupply);
    await equal(/*balances*/[fp(100), fp(0)], /*lpAmountIn*/fp(100), lpSupply);
    
    await equal(/*balances*/[fp(10), fp(100)], /*lpAmountIn*/fp(1), lpSupply);
    await equal(/*balances*/[fp(100), fp(10)], /*lpAmountIn*/fp(1), lpSupply);
    await equal(/*balances*/[fp(0), fp(100)], /*lpAmountIn*/fp(1), lpSupply);
    await equal(/*balances*/[fp(100), fp(0)], /*lpAmountIn*/fp(1), lpSupply);
  });

  it('getTokenBalance', async () =>
  {
    const equal = (...args:any[]) => expectEquals(mockMath.getTokenBalance, getTokenBalance, ...args);

    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*invariant:*/fp(21), /*firstToken*/true);
    await equal(amp(100), /*balances*/[fp(10), fp(10)], /*invariant:*/fp(20), /*firstToken*/true);
    await equal(amp(100), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(110), /*firstToken*/true);
    await equal(amp(1), /*balances*/[fp(10), fp(10)], /*invariant:*/fp(20), /*firstToken*/true);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(110), /*firstToken*/true);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/true);

    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/true);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/true);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/true);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/true);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/true);

    await equal(amp(100), /*balances*/[fp(10), fp(11)], /*invariant:*/fp(21), /*firstToken*/false);
    await equal(amp(100), /*balances*/[fp(10), fp(10)], /*invariant:*/fp(20), /*firstToken*/false);
    await equal(amp(100), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(110), /*firstToken*/false);
    await equal(amp(1), /*balances*/[fp(10), fp(10)], /*invariant:*/fp(20), /*firstToken*/false);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(110), /*firstToken*/false);
    await equal(amp(1), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/false);

    await equal(amp(5), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/false);
    await equal(amp(10), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/false);
    await equal(amp(20), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/false);
    await equal(amp(50), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/false);
    await equal(amp(90), /*balances*/[fp(10), fp(100)], /*invariant:*/fp(10), /*firstToken*/false);
  });
});
