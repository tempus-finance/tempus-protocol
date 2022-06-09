import { expect } from "chai";
import { BigNumber } from "ethers";
import { Decimal, decimal } from "@tempus-sdk/utils/Decimal";
import { Numberish, formatDecimal, parseDecimal } from "@tempus-sdk/utils/DecimalUtils";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";

describeNonPool("Decimal", () =>
{
  describe(`Decimal v${Decimal.version}`, () =>
  {
    const dec18 = (x:Numberish):Decimal => decimal(x, 18);
    const dec6 = (x:Numberish):Decimal => decimal(x, 6);
    const int = (x:Numberish):Decimal => decimal(x, 0);

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
      equals(dec6('123.45678901'), '123.456789');
      equals(dec6('123.456789012345678'), '123.456789');
      equals(dec6('123.4567899'), '123.456789');
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
      equals(dec6('-123.45678901'), '-123.456789');
      equals(dec6('-123.456789012345678'), '-123.456789');
      equals(dec6('-123.4567899'), '-123.456789');
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

    it("toTruncated: truncates excess digits", () =>
    {
      equals(dec18('100.12345678901234567890').toTruncated(), '100');
      equals(dec18('100.12345678901234567890').toTruncated(6), '100.123456');
      equals(dec6('100.123456').toTruncated(8), '100.123456');

      equals(dec18('-100.12345678901234567890').toTruncated(), '-100');
      equals(dec18('-100.12345678901234567890').toTruncated(6), '-100.123456');
      equals(dec6('-100.123456').toTruncated(8), '-100.123456');
    });

    it("toRounded: rounds excess digits", () =>
    {
      equals(dec6('0.000000').toRounded(-1), '0');
      equals(dec18('0.000000').toRounded(-1), '0');
      equals(dec18('0.004').toRounded(-1), '0.004');
      equals(dec18('0.004555').toRounded(3), '0.005');
      equals(dec18('100.04000000000').toRounded(-1), '100.04');
      equals(dec18('100.04555555555').toRounded(3), '100.046');
      equals(dec18('100.04555555555').toRounded(6), '100.045556');

      equals(dec18('0.000000000000000000').toRounded(-1), '0');
      equals(dec18('0.040000000000000000').toRounded(-1), '0.04');
      equals(dec18('1.000000000000000000').toRounded(-1), '1');
      equals(dec18('30.000000000000000000').toRounded(-1), '30');

      equals(dec18('100.5432149898').toRounded(0), '100');
      equals(dec18('100.5432149898').toRounded(6), '100.543215');
      equals(dec18('100.5432141198').toRounded(6), '100.543214');
      equals(dec6('100.123456').toRounded(8), '100.123456');

      equals(dec18('-100.5432149898').toRounded(0), '-100');
      equals(dec18('-100.12345678901234567890').toRounded(6), '-100.123457');
      equals(dec18('-100.12345612901234567890').toRounded(6), '-100.123456');
      equals(dec6('-100.123456').toRounded(8), '-100.123456');
    });

    it("toNumber", () =>
    {
      // Number can carry 17 significant digits
      equals(dec18('100.12345678901234567890').toNumber(), '100.12345678901235');
    });

    it("abs", () =>
    {
      equals(dec6('100.543214').abs(), '100.543214');
      equals(dec6('-100.543214').abs(), '100.543214');
      equals(dec6('0').abs(), '0.000000');
    });

    it("equals", () =>
    {
      expect(dec6('100.543214').equals('100.543214')).to.be.true;
      expect(dec6('100.543214').equals('100.5')).to.be.false;
      expect(dec6(1.0).equals(1.0)).to.be.true;
      expect(dec6(1.0).equals(-1.0)).to.be.false;
      expect(dec6(-1.0).equals(-1.0)).to.be.true;
      expect(dec6(100.5).equals('100.5')).to.be.true;
    });

    it("gt", () =>
    {
      expect(dec6('50.5').gt('50.1')).to.be.true;
      expect(dec6('50.5').gt('50.5')).to.be.false;
      expect(dec6('50.5').gt('50.6')).to.be.false;
      
      expect(dec6('50.5').gt(dec6('50.1'))).to.be.true;
      expect(dec6('50.5').gt(dec6('50.5'))).to.be.false;
      expect(dec6('50.5').gt(dec6('50.6'))).to.be.false;

      expect(dec6('-50.5').gt('50.1')).to.be.false;
      expect(dec6('-50.5').gt('-50.1')).to.be.false;
      expect(dec6('-50.5').gt('-50.9')).to.be.true;
    });

    it("lt", () =>
    {
      expect(dec6('50.5').lt('50.1')).to.be.false;
      expect(dec6('50.5').lt('50.5')).to.be.false;
      expect(dec6('50.5').lt('50.6')).to.be.true;
      
      expect(dec6('50.5').lt(dec6('50.1'))).to.be.false;
      expect(dec6('50.5').lt(dec6('50.5'))).to.be.false;
      expect(dec6('50.5').lt(dec6('50.6'))).to.be.true;

      expect(dec6('-50.5').lt('50.1')).to.be.true;
      expect(dec6('-50.5').lt('-50.1')).to.be.true;
      expect(dec6('-50.5').lt('-50.9')).to.be.false;
    });

    it("gte", () =>
    {
      expect(dec6('50.5').gte('50.1')).to.be.true;
      expect(dec6('50.1').gte('50.5')).to.be.false;

      expect(dec6('50.5').gte('50.5')).to.be.true;
      expect(dec6('-50.5').gte('-50.5')).to.be.true;
    });

    it("lte", () =>
    {
      expect(dec6('50.5').lte('50.1')).to.be.false;
      expect(dec6('50.1').lte('50.5')).to.be.true;

      expect(dec6('50.5').lte('50.5')).to.be.true;
      expect(dec6('-50.5').lte('-50.5')).to.be.true;
    });

    it("chai equality tests", () =>
    {
      expect(dec18('100.123456')).to.eql(dec18('100.123456'));
      expect(dec18('100.123456')).to.not.equal(dec18('100.123456'));
      expect(+dec18('100.123456')).to.equal(100.123456);
      expect(dec18('100.123456')).to.not.equal(100.123456);
    });

    type BinaryOp<T> = (a:number, b:number) => T;

    // toFixed, but with BigNumber-like rounding
    function truncate(x:number, precision:number): string {
      const [whole, fract] = x.toFixed(precision + 6).split('.');
      if (!fract) return whole;
      return whole + '.' + fract.slice(0, Math.min(fract.length, precision));
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

  describe("DecimalUtils", () =>
  {
    function bn18(x:Numberish): BigNumber {
      const parts = x.toString().split('.');
      const whole = BigNumber.from(parts[0]);
      if (parts.length === 1) // it was an integer, return it as-is
        return whole;
      // it's a decimal fraction, scale it up:
      const sign = BigNumber.from(whole.isNegative() ? '-1' : '1');
      const fractString = parts[1].padEnd(18, '0'); // pad 04 to 040000000000000000
      const fract = BigNumber.from(fractString);
      const scaledResult = whole.abs().mul('1000000000000000000').add(fract).mul(sign);
      return scaledResult;
    }

    describe("parseDecimal", () =>
    {
      expect(parseDecimal('0.000000000000000000', 18)).to.equal(bn18('0'));
      expect(parseDecimal('0.040000000000000000', 18)).to.equal(bn18('0.04'));
      expect(parseDecimal('1.000000000000000000', 18)).to.equal(bn18('1.0'));
      expect(parseDecimal('30.000000000000000000', 18)).to.equal(bn18('30.0'));
    });

    describe("formatDecimal", () =>
    {
      expect(formatDecimal(bn18('0.000000000000000000'), 18)).to.equal(0);
      expect(formatDecimal(bn18('0.040000000000000000'), 18)).to.equal(0.04);
      expect(formatDecimal(bn18('1.000000000000000000'), 18)).to.equal(1);
      expect(formatDecimal(bn18('30.000000000000000000'), 18)).to.equal(30);
    });
  });
});
