import { screen } from "cc";

/** 屏幕比例类型 */
export enum AdaptRatioType {
  IPhone6_Landscape = 17787,
  IPhone6_Portrait = 5622,
  IPhoneX_Landscape = 21653,
  IPhoneX_Portrait = 4618,
  IPad_Landscape = 13333,
  IPad_Portrait = 7500,
}

/** 屏幕比例掩码 */
export enum AdaptRatioMask {
  IPhone6_Landscape = 1 << 0,
  IPhone6_Portrait = 1 << 1,
  IPhoneX_Landscape = 1 << 2,
  IPhoneX_Portrait = 1 << 3,
  IPad_Landscape = 1 << 4,
  IPad_Portrait = 1 << 5,
}

/** 屏幕方向 */
export enum OrientationType {
  Portrait = 0,
  Landscape = 1,
}

export class ScreenUtils {
  static RATIO_UNIT = 10000;
  static DESIGN_WIDTH = 1334;
  static DESIGN_HEIGHT = 750;
  static defaultSizeRatios: number[] = [
    ScreenUtils.getRatioValue(
      ScreenUtils.DESIGN_WIDTH,
      ScreenUtils.DESIGN_HEIGHT,
    ),
    ScreenUtils.getRatioValue(
      ScreenUtils.DESIGN_HEIGHT,
      ScreenUtils.DESIGN_WIDTH,
    ),
  ];

  static getScreenRatio() {
    const size = screen.windowSize;
    return ScreenUtils.getRatioValue(size.width, size.height);
  }

  static getAdaptRatioType() {
    const screenRatio = ScreenUtils.getScreenRatio();
    let nearestType;
    let minDiff = Infinity;
    for (const key of Object.keys(AdaptRatioType)) {
      if (!isNaN(Number(key))) continue;
      const ratio = AdaptRatioType[key];
      const diff = Math.abs(ratio - screenRatio);
      if (diff < minDiff) {
        minDiff = diff;
        nearestType = ratio;
      }
    }
    return nearestType ?? AdaptRatioType.IPhone6_Portrait;
  }

  static getRatioValue(width, height) {
    return Math.round((width / height) * ScreenUtils.RATIO_UNIT);
  }

  static getNearestRatioData(ratio, datas) {
    let minDiff = Infinity;
    let nearestIndex = -1;
    for (let i = 0; i < datas.length; i++) {
      const diff = Math.abs(datas[i].ratio - ratio);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIndex = i;
      }
    }
    return datas[nearestIndex];
  }

  static getDefaultRatioData(ratio, datas) {
    let minDiff = Infinity;
    for (const defaultRatio of ScreenUtils.defaultSizeRatios) {
      const diff = Math.abs(defaultRatio - ratio);
      if (diff < minDiff) {
        minDiff = diff;
      }
    }
    return datas.find((d) => d.ratio === minDiff);
  }
}
