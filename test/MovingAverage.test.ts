import { Contract } from "ethers";
import { ContractBase } from "./utils/ContractBase";
import { expect } from "chai";
import { Numberish, toWei } from "./utils/DecimalUtils";
import { increaseTime } from "./utils/Utils";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";

describeNonPool("MovingAverage", async () => {
  enum MAType {
    EMA = 0,
    DEMA = 1,
  }
  class MovingAverageMock extends ContractBase {
    constructor(contract:Contract) {
      super("MovingAverageMock", 18, contract);
    }

    static async create(
      type:MAType,
      updateInterval:Numberish,
      newValueWeight:Numberish,
      trendWeight:Numberish = 0
    ): Promise<MovingAverageMock> {
      return new MovingAverageMock(await ContractBase.deployContract("MovingAverageMock",
        type.valueOf(),
        updateInterval.valueOf(),
        toWei(newValueWeight),
        toWei(trendWeight)
      ));
    }

    async update(newValue:Numberish): Promise<Numberish> {
      await this.contract.update(this.toBigNum(newValue));
      return this.value();
    }

    async value(): Promise<Numberish> {
      return this.fromBigNum(await this.contract.value());
    }
  }

  describe("Biased EMA", () =>
  {
    it("Update is only triggered when interval elapses [regular bias range]", async () =>
    {
      const ema = await MovingAverageMock.create(MAType.EMA, /*interval:*/2*60.0, /*weight:*/0.5);
      expect(await ema.value()).to.equal(0, "initial value should be 0");
      expect(await ema.update(1.0)).to.equal(1.0, "first update sets the value");
      
      expect(await ema.update(1.1)).to.equal(1.0, "should not trigger update before interval elapsed");
      await increaseTime(2*60.0);
      expect(await ema.update(1.1)).to.equal(1.05, "ema.value should move 0.5x towards new value");
      expect(await ema.update(1.1)).to.equal(1.05, "should not trigger update before interval elapsed");
    });
  
    it("Update moves according to weight [regular bias range]", async () =>
    {
      const ema = await MovingAverageMock.create(MAType.EMA, /*interval:*/2*60.0, /*weight:*/0.5);
      expect(await ema.update(1.0)).to.equal(1.0, "first update sets the value");

      // regular weight = weight(0.5) * 1.0 = 0.5
      await increaseTime(2*60.0);
      expect(await ema.update(1.1)).to.equal(1.05, "ema.value should move 0.5x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(1.1)).to.equal(1.075, "ema.value should move 0.5x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(1.1)).to.equal(1.0875, "ema.value should move 0.5x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(1.1)).to.equal(1.09375, "ema.value should move 0.5x towards new value");
    });
  
    it("Update moves according to weight [slower bias range]", async () =>
    {
      const ema = await MovingAverageMock.create(MAType.EMA, /*interval:*/2*60.0, /*weight:*/0.5);
      expect(await ema.update(1.0)).to.equal(1.0, "first update sets the value");

      // slower weight = weight(0.5) * 0.1 = 0.05
      await increaseTime(2*60.0);
      expect(await ema.update(2.0)).to.equal(1.05, "ema.value should move 0.05x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(2.0)).to.equal(1.0975, "ema.value should move 0.05x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(2.0)).to.equal(1.142625, "ema.value should move 0.05x towards new value");
    });
  
    it("Update moves according to weight [sensitive bias range]", async () =>
    {
      const ema = await MovingAverageMock.create(MAType.EMA, /*interval:*/2*60.0, /*weight:*/0.1);
      expect(await ema.update(1.0)).to.equal(1.0, "first update sets the value");

      // sensitive weight = weight(0.1) * 3.0 = 0.3
      await increaseTime(2*60.0);
      expect(await ema.update(1.01)).to.equal(1.003, "ema.value should move 0.3x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(1.01)).to.equal(1.0051, "ema.value should move 0.3x towards new value");
      await increaseTime(2*60.0);
      expect(await ema.update(1.01)).to.equal(1.00657, "ema.value should move 0.3x towards new value");
    });
  });

  describe("Biased DEMA", () =>
  {
    it("Update is only triggered when interval elapses [regular bias range]", async () =>
    {
      const dema = await MovingAverageMock.create(MAType.DEMA, /*interval:*/2*60.0, /*weight:*/0.5, /*trendW:*/0.01);
      expect(await dema.value()).to.equal(0, "initial value should be 0");
      expect(await dema.update(1.0)).to.equal(1.0, "first update sets the value");
      
      expect(await dema.update(1.1)).to.equal(1.0, "should not trigger update before interval elapsed");
      await increaseTime(2*60.0);
      expect(await dema.update(1.1)).to.equal(1.05, "DEMA.value should move 0.5x towards new value");
      expect(await dema.update(1.1)).to.equal(1.05, "should not trigger update before interval elapsed");
    });
  
    it("Update moves according to weight [regular bias range]", async () =>
    {
      const dema = await MovingAverageMock.create(MAType.DEMA, /*interval:*/2*60.0, /*weight:*/0.5, /*trendW:*/0.01);
      expect(await dema.update(1.0)).to.equal(1.0, "first update sets the value");

      // regular weight = weight(0.5) * 1.0 = 0.5
      await increaseTime(2*60.0);
      expect(await dema.update(1.1)).to.equal(1.05, "DEMA.value should move 0.5x towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(1.1)).to.equal(1.07525, "DEMA.value should move 0.5x + trend towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(1.1)).to.equal(1.08799875, "DEMA.value should move 0.5x + trend towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(1.1)).to.equal(1.09443313125, "DEMA.value should move 0.5x + trend towards new value");
    });
  
    it("Update moves according to weight [slower bias range]", async () =>
    {
      const dema = await MovingAverageMock.create(MAType.DEMA, /*interval:*/2*60.0, /*weight:*/0.5, /*trendW:*/0.01);
      expect(await dema.update(1.0)).to.equal(1.0, "first update sets the value");

      // slower weight = weight(0.5) * 0.1 = 0.05
      await increaseTime(2*60.0);
      expect(await dema.update(2.0)).to.equal(1.05, "DEMA.value should move 0.05x towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(2.0)).to.equal(1.097975, "DEMA.value should move 0.05x + trend towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(2.0)).to.equal(1.1440022625, "DEMA.value should move 0.05x + trend towards new value");
    });
  
    it("Update moves according to weight [sensitive bias range]", async () =>
    {
      const dema = await MovingAverageMock.create(MAType.DEMA, /*interval:*/2*60.0, /*weight:*/0.1, /*trendW:*/0.01);
      expect(await dema.update(1.0)).to.equal(1.0, "first update sets the value");

      // sensitive weight = weight(0.1) * 3.0 = 0.3
      await increaseTime(2*60.0);
      expect(await dema.update(1.01)).to.equal(1.003, "DEMA.value should move 0.3x towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(1.01)).to.equal(1.005121, "DEMA.value should move 0.3x + trend towards new value");
      await increaseTime(2*60.0);
      expect(await dema.update(1.01)).to.equal(1.006620337, "DEMA.value should move 0.3x + trend towards new value");
    });
  });

});
