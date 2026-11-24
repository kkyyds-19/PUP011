import { game, Vec3 } from "cc";

declare var window;

export enum PlatForm {
  Aarki = "Aarki",
  Applovin = "Applovin",
  Facebook = "Facebook",
  Google = "Google",
  IronSource = "IronSource",
  Liftoff = "Liftoff",
  Mintegral = "Mintegral",
  Moloco = "Moloco",
  Tiktok = "Tiktok",
  Unity = "Unity",
  Vungle = "Vungle",
  Wechat = "Wechat",
  Preview = "Preview",
}

export type TAnalyticsConfig = {
  playableId: string; //素材唯一 ID
  playableVersion: string; //素材版本号
  distributorName: string; //发行/项目方名称
};

export class PlayableSDK {
  private static isFirstDisplay = false;

  /**
   * 渠道/平台
   */
  static get platform(): PlatForm {
    if ("__PLATFORM" in window) {
      if (window.__PLATFORM) return PlatForm[window.__PLATFORM];
    }

    if (window.wx) {
      return PlatForm.Wechat;
    }

    return PlatForm.Preview;
  }

  static isGoogle(): boolean {
    return PlayableSDK.platform === PlatForm.Google;
  }

  // static initAnalytics(config: TAnalyticsConfig) {
  // 	if (PlayableSDK.platform === PlatForm.Applovin || PlayableSDK.platform === PlatForm.Unity) {
  // 		if (window.createPlayableAnalytics) {
  // 			const adNetwork = PlayableSDK.platform.toLowerCase();
  // 			window.playableAnalytics = window.createPlayableAnalytics({
  // 				adNetwork,
  // 				...config,
  // 				isLandscape: window.innerWidth > window.innerHeight,
  // 				development: "production",
  // 				maxWidth: window.innerWidth,
  // 				maxHeight: window.innerHeight,
  // 			});
  // 		}
  // 	}
  // }

  static sendGameProgress(progress: number) {
    // 追踪挑战进度，传入 progress 参数
    // AppLovin 渠道：会触发 CHALLENGE_STARTED/CHALLENGE_PASS_25/50/75/CHALLENGE_SOLVED/CHALLENGE_FAILED 事件
    // FunPlus 渠道：进度值会透传到 detail.progress 字段
    if (
      PlayableSDK.platform === PlatForm.Applovin ||
      PlayableSDK.platform === PlatForm.Unity
    ) {
      window.playableAnalytics?.trackCustomEvent("challenge_progress", {
        progress,
      });
    }
  }

  /**
   * 向当前渠道运行时注入商店地址
   * 兼容旧适配器 zzzz_playable 与新打包工具 super-html(super_html) 两套全局对象
   * @public
   * @param storeUrl 不传时使用类内写死的 iosUrl/androidUrl
   */
  static setStoreUrl(storeUrl?: { ios: string; android: string }) {
    // 默认使用写死的商店地址，保证 super-html 各渠道 download 时能取到 URL
    const urls = storeUrl ?? {
      ios: PlayableSDK.iosUrl,
      android: PlayableSDK.androidUrl,
    };
    // 旧 playable-ads-adapter 注入的对象
    if (window.zzzz_playable) {
      window.zzzz_playable.setStore(urls);
    }
    // super-html 4.2/5.2 及 AppLovin bridge：download() 内部通过 super_get_url 读取这两个字段
    if (window.super_html) {
      window.super_html.appstore_url = urls.ios;
      window.super_html.google_play_url = urls.android;
    }
  }

  /**
   * 隐藏加载进度
   */
  static hideLoadingBar() {
    if (!PlayableSDK.isFirstDisplay) {
      PlayableSDK.isFirstDisplay = true;
      window.playableAnalytics?.onDisplay();
    }
    if (window.setLoadingProgress) {
      window.setLoadingProgress(100);
    }
  }

  /**
   * 按当前设备解析应跳转的商店地址
   * 判定必须与渠道运行时保持一致：安卓 UA 走 Google Play，其余（桌面 / iOS）走 App Store
   * 详见 super_get_url、zzzz_playable.mraidOpen 的原始实现
   */
  private static resolveStoreUrl(): string {
    const nav = window.navigator || {};
    const ua = `${nav.userAgent || ""} ${nav.vendor || ""}`;
    return /android/i.test(ua) ? PlayableSDK.androidUrl : PlayableSDK.iosUrl;
  }

  /**
   * 本地自测开关：html 地址后加 ?localTest=1，或提前设置 window.__PLAYABLE_LOCAL_TEST = true
   * 开启后跳过渠道运行时，直接打开商店地址
   */
  private static get isLocalTest(): boolean {
    if (window.__PLAYABLE_LOCAL_TEST) {
      return true;
    }
    return /[?&]localTest=1/.test(window.location.search || "");
  }

  /**
   * 直接打开商店地址（不经过渠道运行时）
   * 网页版要求"新建页面"，所以优先 window.open(_blank)；
   * 被弹窗拦截（返回 null）时再用 <a target="_blank"> 兜底 —— Google 包会加载官方 exitapi.js
   * 劫持 window.open，那种情况下链接点击更稳。
   */
  private static openStoreDirectly(url: string) {
    if (!url) {
      console.warn("[PlayableSDK] 未配置商店地址，已跳过跳转");
      return;
    }

    try {
      // 用最普通的两参形式：部分 WebView 对带 noopener 的三参形式处理不一样，会被当成当前页导航
      const win = window.open(url, "_blank");
      if (win) return;
    } catch (e) {
      // 部分 WebView 不允许 window.open，走下面的 <a> 兜底
    }

    const doc = window.document;
    const a = doc.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    doc.body.appendChild(a);
    a.click();
    a.parentNode && a.parentNode.removeChild(a);
  }

  /**
   * 跳转下载
   * @param from   结束页面一定要传入 'EndPage'，否则不会额外触发 onCompleted 统计事件
   */
  static download(from?: string) {
    // 先上报统计（Full 包不通关也照样要报），再决定要不要真的跳商店
    PlayableSDK.reportInstall(from);
    PlayableSDK.jumpToStore(true);
  }

  /**
   * 只做渠道统计上报，不打开商店。
   * Full 模式下游戏不会自动跳转商店，但完成统计仍然要上报。
   */
  static reportInstall(from?: string) {
    if (!window.playableAnalytics) return;
    window.playableAnalytics.onInstall("None");
    if (from === "EndPage") {
      window.gameEnd && window.gameEnd();
      // 通知 PlayableVariantKit 生命周期结束（InstantRedirect 包在这里就会跳商店）
      window.PlayableVariantKit?.gameEnd?.();
      window.playableAnalytics.onCompleted();
    }
  }

  /**
   * 只做商店跳转，不重复上报统计
   * 用于通关后反复点击屏幕的场景（避免每次点击都重复 onInstall / onCompleted）
   * @param auto  true 表示由游戏逻辑自动触发（通关落版、倒计时结束等），
   *              Full 包不允许自动跳转，会被 PlayableVariantKit 拦下；
   *              false 表示玩家主动点击（CTA 按钮），任何模式都允许。
   */
  static jumpToStore(auto = false) {
    // Full 包不允许自动跳转：只有玩家主动点 CTA 才打开商店
    if (auto && !PlayableSDK.allowsAutoRedirect()) return;

    // 先算好真实地址：渠道运行时取不到地址时会执行 window.open("") / window.open(undefined)，表现为新标签页停在 about:blank
    const storeUrl = PlayableSDK.resolveStoreUrl();
    // 同时把写死的商店地址注入当前渠道运行时对象
    PlayableSDK.setStoreUrl();

    // 网页版（没有真实广告渠道标识）：直接新标签页打开，任何渠道桥都不走。
    // super_html.download / zzzz_playable.download 在网页里都是用 location 在本页面跳转。
    // 注意 platform 可能是 undefined（__PLATFORM 填了未登记的名字），一并当成网页版处理。
    const platform = PlayableSDK.platform;
    if (!platform || platform === PlatForm.Preview || PlayableSDK.isLocalTest) {
      PlayableSDK.openStoreDirectly(storeUrl);
      return;
    }

    // 真实渠道：优先交给 PlayableVariantKit（super_html → mraid → window.open 三级兜底）
    if (auto) {
      const kit = window.PlayableVariantKit;
      if (kit) {
        // 已经跳过一次商店（玩家点过 CTA / 倒计时已触发），不要再重复打开
        if (kit.isStoreOpened) return;
        if (kit.autoRedirect?.()) return;
      }
    } else if (window.PlayableVariantKit?.openStore?.()) {
      return;
    }
    if (window.zzzz_playable) {
      // 旧 playable-ads-adapter / Google：内部优先 ExitApi.exit()，其次按 storeUrl 走 winOpen
      window.zzzz_playable.download();
      return;
    }
    if (window.super_html) {
      // super-html：download(url) 支持直接传地址（super_get_url 对非空入参原样返回），
      // 不再只依赖 super_html.google_play_url / appstore_url 两个字段是否被读到
      window.super_html.download(storeUrl);
      return;
    }
    if (PlayableSDK.platform === PlatForm.Wechat) {
      window.wx.notifyMiniProgramPlayableStatus({
        isEnd: true,
      });
      return;
    }
    // 浏览器预览环境无渠道对象，按同一套 UA 判定直接打开商店地址
    // （电脑浏览器走 App Store，安卓设备走 Google Play，与各渠道运行时一致）
    PlayableSDK.openStoreDirectly(storeUrl);
  }

  ///// 跳转模式判定（由 PlayableVariantKit 提供；没有该组件时全部放行，保持旧行为）

  /**
   * 游戏逻辑触发的自动跳转是否允许。
   * Full 包不允许自动跳转（只有玩家主动点 CTA 才打开商店），其余模式允许。
   */
  static allowsAutoRedirect(): boolean {
    const kit = window.PlayableVariantKit;
    if (!kit) return true;
    return kit.allowsAutoRedirect !== false;
  }

  /**
   * CTA 按钮是否允许立即跳转。
   * 1Click~5Click 包不允许：要等全屏点击数达标才会跳，避免按钮提前把玩家带走。
   */
  static allowsCtaRedirect(): boolean {
    const kit = window.PlayableVariantKit;
    if (!kit) return true;
    return kit.allowsCtaRedirect !== false;
  }

  ///// 上报数据

  static reportGameRetry() {
    if (window.playableAnalytics) {
      window.playableAnalytics.onRetry();
    }
  }
  /**
   * @param totalGames 游戏次数
   * @param result 本次游戏结果，通关win、通关失败lose
   */
  static reportGameEnd() {
    window.gameEnd && window.gameEnd(); 
    // 同时通知 PlayableVariantKit 生命周期结束（InstantRedirect 包在这里会跳商店）
    window.PlayableVariantKit?.gameEnd?.();
    if (window.playableAnalytics) {
      window.playableAnalytics.onShowEndCard();
    }
  }

  /** 安卓 Google Play 商店地址（写死，原 .adapterrc 中 storeUrl.android） */
  static androidUrl =
    "https://play.google.com/store/apps/details?id=com.appynation.puzzlepage&hl=en";
  /** iOS App Store 商店地址（写死，原 .adapterrc 中 storeUrl.ios） */
  static iosUrl =
    "https://apps.apple.com/us/app/puzzle-page-daily-games/id1308181322";
}

