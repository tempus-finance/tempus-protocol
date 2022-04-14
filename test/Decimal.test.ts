import { expect } from "chai";
import { BigNumber } from "ethers";
import { Numberish, Decimal, decimal } from "./utils/Decimal";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";

describeNonPool("Decimal Utils", () =>
{
  describe("Decimal", () =>
  {
    const dec18 = (x):Decimal => decimal(x, 18);
    const dec6 = (x):Decimal => decimal(x, 6);
    const int = (x):Decimal => decimal(x, 0);

    // [-1.0; +1.0] * scale
    const rand = (scale:number):number => (Math.random() - 0.5) * 2.0 * scale;
    const rand6 = (scale:number):number => Number(rand(scale).toFixed(6)).valueOf();

    function equals(a:Numberish, b:string, msg?:string) {
      expect(a.toString()).to.be.equal(b, msg);
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
      equals(dec6(BigNumber.from('12340123456')), '12340.123456');
      equals(dec6(dec6(1.654321)), '1.654321');
      equals(dec6(dec18('1.123456789012345678')), '1.123456');

      equals(dec18('-100.123456789012345678'), '-100.123456789012345678');
      equals(dec6(-10.0), '-10.000000');
      equals(dec6(Number(-10.0)), '-10.000000');
      equals(dec6(-123.4567890), '-123.456789');
      equals(dec6('-123.4567890'), '-123.456789');
      equals(int('-1234567890'), '-1234567890');
      equals(int('-123.4567890'), '-123');
      equals(dec6(BigNumber.from('-12340123456')), '-12340.123456');
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

    it("toNumber", () =>
    {
      // Number can carry 17 significant digits
      equals(dec18('100.12345678901234567890').toNumber(), '100.12345678901235');
    });

    type BinaryOp<T> = (a:number, b:number) => T;

    // toFixed, but with BigNumber-like rounding
    function truncate(x:number, precision:number): string {
      const [whole, fract] = x.toFixed(precision + 6).split('.');
      if (!fract) return whole;
      return whole + '.' + fract.substring(0, Math.min(fract.length, precision));
    }

    function generateAndTest(what:string, op1:BinaryOp<Decimal>, op2:BinaryOp<number>) {
      for (let i = 0; i < 1000; ++i) {
        const [a, b] = [rand6(100), rand6(100)];
        const actual = op1(a, b).toString();
        const expected = truncate(op2(a, b), 6);
        equals(actual, expected, `${a} ${what} ${b} expected=${expected} actual=${actual}`);
      }
    }

    describe("add()", () =>
    {
      it("basic", () =>
      {
        equals(dec6('10.000000').add('20.0'), '30.000000');
        equals(dec6('10.530200').add('20.004001'), '30.534201');
        equals(dec6('10').add(20), '30.000000');
        equals(dec6(10).add(20), '30.000000');
        equals(dec6(Number(10)).add(20), '30.000000');
      });

      it("negative numbers", () =>
      {
        equals(dec6(-10).add(5), '-5.000000');
        equals(dec6(-10).add(-5), '-15.000000');
      });

      it("mixed decimal numbers", () =>
      {
        // check if mixed precision decimals lead to sane results
        equals(dec18(100.5).add(dec6(0.5)), '101.000000000000000000');
        equals(dec18(100.5).add(dec6(-0.5)), '100.000000000000000000');
        equals(dec6(100.5).add(dec18(0.5)), '101.000000');
        equals(dec6(100.5).add(dec18(-0.5)), '100.000000');
      });

      it("random numbers", () =>
      {
        generateAndTest('+', (a,b) => dec6(a).add(b), (a,b) => a + b);
      });
    });

    describe("sub()", () =>
    {
      it("basic", () =>
      {
        equals(dec6('20.000000').sub('5.0'), '15.000000');
        equals(dec6('20.535203').sub('5.004001'), '15.531202');
        equals(dec6('20').sub(5), '15.000000');
        equals(dec6(20).sub(5), '15.000000');
        equals(dec6(Number(20)).sub(5), '15.000000');
      });

      it("negative numbers", () =>
      {
        equals(dec6(-10).sub(5), '-15.000000');
        equals(dec6(-10).sub(-5), '-5.000000');
      });

      it("mixed decimal numbers", () =>
      {
        // check if mixed precision decimals lead to sane results
        equals(dec18(100.5).sub(dec6(0.5)), '100.000000000000000000');
        equals(dec18(100.5).sub(dec6(-0.5)), '101.000000000000000000');
        equals(dec6(100.5).sub(dec18(0.5)), '100.000000');
        equals(dec6(100.5).sub(dec18(-0.5)), '101.000000');
      });

      it("random numbers", () =>
      {
        generateAndTest('-', (a,b) => dec6(a).sub(b), (a,b) => a - b);
      });
    });

    describe("mul()", () =>
    {
      it("basic", () =>
      {
        equals(dec6('10.000000').mul('20.0'), '200.000000');
        equals(dec6('10.241232').mul('20.213327'), '207.009371');
        equals(dec6('10').mul(20), '200.000000');
        equals(dec6(10).mul(20), '200.000000');
        equals(dec6(Number(10)).mul(20), '200.000000');
      });

      it("negative numbers", () =>
      {
        equals(dec6(-10).mul(5), '-50.000000');
        equals(dec6(-10).mul(-5), '50.000000');
        equals(dec6(-10.123).mul(-5.723), '57.933929');
      });

      it("mixed decimal numbers", () =>
      {
        // check if mixed precision decimals lead to sane results
        equals(dec18(100.5).mul(dec6(0.5)), '50.250000000000000000');
        equals(dec18(100.5).mul(dec6(-0.5)), '-50.250000000000000000');
        equals(dec6(100.5).mul(dec18(0.5)), '50.250000');
        equals(dec6(100.5).mul(dec18(-0.5)), '-50.250000');
      });

      it("random numbers", () =>
      {
        generateAndTest('*', (a,b) => dec6(a).mul(b), (a,b) => a * b);
      });
    });

    describe("div()", () =>
    {
      it("basic", () =>
      {
        equals(dec6('10.000000').div('20.0'), '0.500000');
        equals(dec6('10.241232').div('20.21337'), '0.506656');
        equals(dec6('10').div(20), '0.500000');
        equals(dec6(10).div(20), '0.500000');
        equals(dec6(Number(10)).div(20), '0.500000');
      });

      it("negative numbers", () =>
      {
        equals(dec6(-10).div(5), '-2.000000');
        equals(dec6(-10).div(-5), '2.000000');
        equals(dec6(-10.123).div(-5.723), '1.768827');
      });

      it("mixed decimal numbers", () =>
      {
        // check if mixed precision decimals lead to sane results
        equals(dec18(100.5).div(dec6(0.5)), '201.000000000000000000');
        equals(dec18(100.5).div(dec6(-0.5)), '-201.000000000000000000');
        equals(dec6(100.5).div(dec18(0.5)), '201.000000');
        equals(dec6(100.5).div(dec18(-0.5)), '-201.000000');
      });

      it("random numbers", () =>
      {
        generateAndTest('/', (a,b) => dec6(a).div(b), (a,b) => a / b);
      });

      it("underflow is truncated", () =>
      {
        equals(dec6('0.000001').div(2), '0.000000');
      });
    });
  });
});
