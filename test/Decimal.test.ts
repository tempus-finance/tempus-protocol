import { expect } from "chai";
import { Decimal, decimal, DEFAULT_DECIMAL_PRECISION } from "./utils/Decimal";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";

describeNonPool.only("Decimal Utils", () =>
{
  describe("Decimal", () =>
  {
    const decimal18 = (x):Decimal => decimal(x, 18);
    const decimal6 = (x):Decimal => decimal(x, 6);
    const decimalstr = (x,p=DEFAULT_DECIMAL_PRECISION) => decimal(x,p).toString();
    const str = (x:Decimal):string => x.toString();

    it("Excess precision is truncated during init", () =>
    {
      expect(decimalstr('100.12345678901234567890')).to.equal('100.123456789012345678', "maxDecimals=default");
      expect(decimalstr('-100.12345678901234567890')).to.equal('-100.123456789012345678', "maxDecimals=default");
      expect(decimalstr('100.12345678901234567890', 18)).to.equal('100.123456789012345678', "maxDecimals=18");
      expect(decimalstr('-100.12345678901234567890', 18)).to.equal('-100.123456789012345678', "maxDecimals=18");
      expect(decimalstr('100.12345678901234567890', 6)).to.equal('100.123456', "maxDecimals=6");
      expect(decimalstr('-100.12345678901234567890', 6)).to.equal('-100.123456', "maxDecimals=6");
    });

    it("add", () =>
    {
      expect(decimal6(10).add(20)).to.equal(30);
    });

    it("Division does not add additional fraction digits for maxDecimals=6", () =>
    {
      expect(str(decimal6('0.000001').div(decimal6(2.0)))).to.equal(str(decimal6(0.0)));
    });
  });
});
