import { expect } from "chai";
import { BigNumber } from "ethers";
import { Decimal, decimal } from "./utils/Decimal";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";

describeNonPool.only("Decimal Utils", () =>
{
  describe("Decimal", () =>
  {
    const dec18 = (x):Decimal => decimal(x, 18);
    const dec6 = (x):Decimal => decimal(x, 6);
    const int = (x):Decimal => decimal(x, 0);

    // [-1.0; +1.0] * scale
    const rand = (scale:number):number => (Math.random() - 0.5) * 2.0 * scale;
    const rand6 = (scale:number):number => Number(rand(scale).toFixed(6)).valueOf();

    function equals(a:Decimal|string, b:string, msg?:string) {
      expect((typeof(a) !== "string") ? a.str() : a).to.be.equal(b, msg);
    }

    // easier to test init and toString together
    it("init/toString", () =>
    {
      equals(dec18('100.123456789012345678'), '100.123456789012345678');
      equals(dec6(10.0), '10.000000');
      equals(dec6(Number(10.0)), '10.000000');
      equals(dec6(123.4567890), '123.456789');
      equals(dec6('123.4567890'), '123.456789');
      equals(int('1234567890'), '1234567890');
      equals(int('123.4567890'), '123');
      equals(decimal(BigNumber.from('12340123456'), 6), '12340.123456');
      equals(dec6(dec6(1.654321)), '1.654321');
      equals(dec6(dec18('1.123456789012345678')), '1.123456');

      equals(dec18('-100.123456789012345678'), '-100.123456789012345678');
      equals(dec6(-10.0), '-10.000000');
      equals(dec6(Number(-10.0)), '-10.000000');
      equals(dec6(-123.4567890), '-123.456789');
      equals(dec6('-123.4567890'), '-123.456789');
      equals(int('-1234567890'), '-1234567890');
      equals(int('-123.4567890'), '-123');
      equals(decimal(BigNumber.from('-12340123456'), 6), '-12340.123456');
      equals(dec6(dec6(-1.654321)), '-1.654321');
      equals(dec6(dec18('-1.123456789012345678')), '-1.123456');
    });

    it("init: excess decimals are truncated", () =>
    {
      equals(dec18('100.12345678901234567890'), '100.123456789012345678');
      equals(dec6('100.12345678901234567890'), '100.123456');

      equals(dec18('-100.12345678901234567890'), '-100.123456789012345678');
      equals(dec6('-100.12345678901234567890'), '-100.123456');
    });

    it("toRounded: truncates excess digits", () =>
    {
      equals(dec18('100.12345678901234567890').toRounded(6), '100.123456');
      equals(dec6('100.123456').toRounded(8), '100.123456');

      equals(dec18('-100.12345678901234567890').toRounded(6), '-100.123456');
      equals(dec6('-100.123456').toRounded(8), '-100.123456');
    });

    it("add basic", () =>
    {
      equals(dec6('10.000000').add('20.0'), '30.000000');
      equals(dec6('10.530200').add('20.004001'), '30.534201');
      equals(dec6('10').add(20), '30.000000');
      equals(dec6(10).add(20), '30.000000');
      equals(dec6(Number(10)).add(20), '30.000000');
    });
    it("add negative numbers", () =>
    {
      equals(dec6(-10).add(5), '-5.000000');
      equals(dec6(-10).add(-5), '-15.000000');
    });
    it("add mixed decimal numbers", () =>
    {
      // check if mixed precision decimals lead to sane results
      equals(dec18(100.5).add(dec6(0.5)), '101.000000000000000000');
      equals(dec18(100.5).add(dec6(-0.5)), '100.000000000000000000');
      equals(dec6(100.5).add(dec18(0.5)), '101.000000');
      equals(dec6(100.5).add(dec18(-0.5)), '100.000000');
    });
    it("add random numbers", () =>
    {
      for (let i = 0; i < 1000; ++i) {
        const [a, b] = [rand6(1000), rand6(1000)];
        const expected = (a + b).toFixed(6);
        equals(dec6(a).add(b), expected, `${a} + ${b} should be ${expected}`);
      }
    });

    it("sub basic", () =>
    {
      equals(dec6('20.000000').sub('5.0'), '15.000000');
      equals(dec6('20.535203').sub('5.004001'), '15.531202');
      equals(dec6('20').sub(5), '15.000000');
      equals(dec6(20).sub(5), '15.000000');
      equals(dec6(Number(20)).sub(5), '15.000000');
    });
    it("sub negative numbers", () =>
    {
      equals(dec6(-10).sub(5), '-15.000000');
      equals(dec6(-10).sub(-5), '-5.000000');
    });
    it("sub mixed decimal numbers", () =>
    {
      // check if mixed precision decimals lead to sane results
      equals(dec18(100.5).sub(dec6(0.5)), '100.000000000000000000');
      equals(dec18(100.5).sub(dec6(-0.5)), '101.000000000000000000');
      equals(dec6(100.5).sub(dec18(0.5)), '100.000000');
      equals(dec6(100.5).sub(dec18(-0.5)), '101.000000');
    });
    it("sub random numbers", () =>
    {
      for (let i = 0; i < 1000; ++i) {
        const [a, b] = [rand6(1000), rand6(1000)];
        const expected = (a - b).toFixed(6);
        equals(dec6(a).sub(b), expected, `${a} - ${b} should be ${expected}`);
      }
    });

    it("div: underflow is truncated", () =>
    {
      equals(dec6('0.000001').div(2), '0.000000');
    });
  });
});
