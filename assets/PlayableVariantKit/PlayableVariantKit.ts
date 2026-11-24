import { _decorator, Component, director, input, Input, isValid, Node, sys } from 'cc';

const { ccclass, executionOrder, property } = _decorator;

export enum PlayableRedirectMode {
    Full = 'full',
    Click1 = 'click-1',
    Click2 = 'click-2',
    Click3 = 'click-3',
    Click4 = 'click-4',
    Click5 = 'click-5',
    Time30s = 'time-30s',
    Time120s = 'time-120s',
    InstantRedirect = 'instant-redirect',
}

export const PLAYABLE_GAME_START_EVENT = 'playable:game-start';
export const PLAYABLE_GAME_END_EVENT = 'playable:game-end';

const MODE_ALIASES: Readonly<Record<string, PlayableRedirectMode>> = {
    full: PlayableRedirectMode.Full,
    '1click': PlayableRedirectMode.Click1,
    'click-1': PlayableRedirectMode.Click1,
    '2click': PlayableRedirectMode.Click2,
    'click-2': PlayableRedirectMode.Click2,
    '3click': PlayableRedirectMode.Click3,
    'click-3': PlayableRedirectMode.Click3,
    '4click': PlayableRedirectMode.Click4,
    'click-4': PlayableRedirectMode.Click4,
    '5click': PlayableRedirectMode.Click5,
    'click-5': PlayableRedirectMode.Click5,
    '30s': PlayableRedirectMode.Time30s,
    'time-30s': PlayableRedirectMode.Time30s,
    time30s: PlayableRedirectMode.Time30s,
    '120s': PlayableRedirectMode.Time120s,
    'time-120s': PlayableRedirectMode.Time120s,
    time120s: PlayableRedirectMode.Time120s,
    instantredirect: PlayableRedirectMode.InstantRedirect,
    'instant-redirect': PlayableRedirectMode.InstantRedirect,
};

const CLICK_THRESHOLDS: Readonly<Partial<Record<PlayableRedirectMode, number>>> = {
    [PlayableRedirectMode.Click1]: 1,
    [PlayableRedirectMode.Click2]: 2,
    [PlayableRedirectMode.Click3]: 3,
    [PlayableRedirectMode.Click4]: 4,
    [PlayableRedirectMode.Click5]: 5,
};

/** 时间版本：从首次 gameStart 开始计时，到点后强制打开商店并上报 game_end。 */
const TIME_LIMITS_MS: Readonly<Partial<Record<PlayableRedirectMode, number>>> = {
    [PlayableRedirectMode.Time30s]: 30_000,
    [PlayableRedirectMode.Time120s]: 120_000,
};

const SYNTHETIC_MOUSE_EVENT_WINDOW_MS = 750;

interface PlayableBridge {
    download?: (url: string) => void;
    game_ready?: () => void;
    game_start?: () => void;
    game_end?: () => void;
    google_play_url?: string;
    appstore_url?: string;
}

interface MraidBridge {
    open?: (url: string) => void;
}

interface InjectedVariantConfig {
    mode?: string;
    buildName?: string;
    androidUrl?: string;
    iosUrl?: string;
}

export interface PlayableVariantGlobalApi {
    readonly mode: PlayableRedirectMode;
    /** 游戏逻辑触发的自动跳转是否允许（Full 模式为 false，只允许玩家主动点 CTA）。 */
    readonly allowsAutoRedirect: boolean;
    /** CTA 按钮是否允许立即跳转（1Click~5Click 模式为 false，要等全屏点击数达标）。 */
    readonly allowsCtaRedirect: boolean;
    /** 商店是否已经打开过（避免重复跳转）。 */
    readonly isStoreOpened: boolean;
    ready: () => boolean;
    gameStart: () => boolean;
    gameEnd: () => boolean;
    openStore: () => boolean;
    /** 游戏逻辑触发的自动跳转，Full 模式会被拦截。 */
    autoRedirect: () => boolean;
    download: () => boolean;
    resetSession: () => void;
}

type PlayableWindow = Window & {
    super_html?: PlayableBridge;
    super_html_channel?: string;
    mraid?: MraidBridge;
    __PLAYABLE_VARIANT_CONFIG__?: InjectedVariantConfig;
    __PLAYABLE_REDIRECT_MODE__?: string;
    PlayableVariantKit?: PlayableVariantGlobalApi;
};

function browserWindow(): PlayableWindow | undefined {
    return typeof window === 'undefined' ? undefined : window as PlayableWindow;
}

export function resolvePlayableRedirectMode(rawMode?: string): PlayableRedirectMode {
    let value = rawMode;
    const host = browserWindow();
    if (!value && host) {
        value = host.__PLAYABLE_VARIANT_CONFIG__?.mode || host.__PLAYABLE_REDIRECT_MODE__;
        if (!value) {
            try {
                value = new URLSearchParams(host.location.search).get('redirectMode') || undefined;
            } catch {
                // 广告平台的预览 WebView 可能没有完整 location，此时使用 Full。
            }
        }
    }
    return MODE_ALIASES[(value || '').trim().toLowerCase()] || PlayableRedirectMode.Full;
}

/**
 * 可迁移的多版本跳转组件。
 *
 * 启动场景放置 Prefab 后会创建常驻会话，后续场景中的 Prefab 共享同一会话。CTA 按钮可直接绑定
 * DownloadFun；游戏结束时调用 gameEnd()，或在本节点/Window 派发 playable:game-end。
 */
@ccclass('PlayableVariantKit')
@executionOrder(-1000)
export class PlayableVariantKit extends Component {
    public static instance: PlayableVariantKit | null = null;

    @property({
        displayName: 'Google Play 链接（可留空）',
        tooltip: '留空时读取 playable-variant-kit.config.json 在打包阶段注入的链接。',
    })
    public androidUrl = '';

    @property({
        displayName: 'Apple App Store 链接（可留空）',
        tooltip: '留空时读取 playable-variant-kit.config.json 在打包阶段注入的链接。',
    })
    public iosUrl = '';

    @property({
        displayName: '进入场景自动开始计数',
        tooltip: '仅首次创建会话时生效。关闭后需要调用 gameStart() 或派发 playable:game-start；切换场景不会重新计数。',
    })
    public autoStartGame = true;

    @property({
        displayName: '调试模式覆盖',
        tooltip: '正式包请留空。可填 full、click-1、click-2、click-3、click-4、click-5、time-30s、time-120s、instant-redirect。',
    })
    public modeOverride = '';

    public mode: PlayableRedirectMode = PlayableRedirectMode.Full;

    /**
     * 游戏逻辑触发的自动跳转（通关落版、倒计时结束等）是否允许。
     * Full 模式不允许自动跳转，只有玩家主动点 CTA 才会打开商店。
     */
    public get allowsAutoRedirect(): boolean {
        const target = this.session || this;
        return target.mode !== PlayableRedirectMode.Full;
    }

    /**
     * CTA 按钮是否允许立即跳转。
     * 1Click~5Click 模式不允许：要等全屏点击数达标才会跳，避免按钮提前把玩家带走。
     */
    public get allowsCtaRedirect(): boolean {
        const target = this.session || this;
        return (target.clickThreshold || 0) <= 0;
    }

    /** 商店是否已经打开过：用于避免同一个会话里重复跳转。 */
    public get isStoreOpened(): boolean {
        const target = this.session || this;
        return target.downloadOpened;
    }

    // Scene prefabs remain in place so serialized Button.ClickEvent targets survive
    // scene reloads. Only this dynamically created component owns session state.
    private isSessionOwner = false;
    private clickThreshold = 0;
    private timeLimitMs = 0;
    private redirectTimer: ReturnType<typeof setTimeout> | null = null;
    private screenClickCount = 0;
    private gameStarted = false;
    private readySent = false;
    private startSent = false;
    private endSent = false;
    private downloadOpened = false;
    private screenInputBound = false;
    private lastTouchEndAt = Number.NEGATIVE_INFINITY;
    private installedGlobalApi: PlayableVariantGlobalApi | null = null;

    private get session(): PlayableVariantKit | null {
        const current = PlayableVariantKit.instance;
        return current && isValid(current, true) && isValid(current.node, true) ? current : null;
    }

    protected onLoad(): void {
        if (!this.isSessionOwner) {
            const session = this.session || this.createSession();
            this.mode = session.mode;
            this.bindLifecycleEvents();
            return;
        }
        PlayableVariantKit.instance = this;
        this.mode = resolvePlayableRedirectMode(this.modeOverride);
        this.clickThreshold = CLICK_THRESHOLDS[this.mode] || 0;
        this.timeLimitMs = TIME_LIMITS_MS[this.mode] || 0;
        this.configureBridgeUrls();
        this.bindLifecycleEvents();
        this.installGlobalApi();
        console.log(`[PlayableVariantKit] Redirect mode: ${this.mode}.`);
    }

    private createSession(): PlayableVariantKit {
        // A new runtime node has no serialized scene UUID, so Creator never replaces
        // a scene prefab (and invalidates its CTA references) on a return visit.
        const node = new Node('PlayableVariantKitRuntime');
        node.active = false;
        const session = node.addComponent(PlayableVariantKit);
        session.isSessionOwner = true;
        session.androidUrl = this.androidUrl;
        session.iosUrl = this.iosUrl;
        session.autoStartGame = this.autoStartGame;
        session.modeOverride = this.modeOverride;
        node.parent = this.node.scene;
        director.addPersistRootNode(node);
        node.active = true;
        return session;
    }

    protected start(): void {
        if (!this.isSessionOwner) return;
        this.ready();
        if (this.autoStartGame) this.gameStart();
    }

    protected onEnable(): void {
        if (this.isSessionOwner && this.gameStarted) this.bindScreenInput();
    }

    protected onDisable(): void {
        this.unbindScreenInput();
    }

    protected onDestroy(): void {
        this.unbindScreenInput();
        this.clearTimeLimit();
        this.unbindLifecycleEvents();
        if (!this.isSessionOwner) return;
        director.removePersistRootNode(this.node);
        const host = browserWindow();
        if (host?.PlayableVariantKit === this.installedGlobalApi) delete host.PlayableVariantKit;
        if (PlayableVariantKit.instance === this) PlayableVariantKit.instance = null;
    }

    public ready(): boolean {
        if (!this.isSessionOwner) return this.session?.ready() ?? false;
        if (this.readySent) return false;
        this.readySent = true;
        this.configureBridgeUrls();
        browserWindow()?.super_html?.game_ready?.();
        return true;
    }

    public gameStart(): boolean {
        if (!this.isSessionOwner) return this.session?.gameStart() ?? false;
        if (this.gameStarted || this.endSent) return false;
        this.ready();
        this.gameStarted = true;
        this.startSent = true;
        this.screenClickCount = 0;
        browserWindow()?.super_html?.game_start?.();
        if (this.enabledInHierarchy) this.bindScreenInput();
        if (this.timeLimitMs > 0) this.startTimeLimit();
        return true;
    }

    public gameEnd(): boolean {
        if (!this.isSessionOwner) return this.session?.gameEnd() ?? false;
        if (this.endSent) return false;
        this.endSent = true;
        browserWindow()?.super_html?.game_end?.();
        if (this.mode === PlayableRedirectMode.InstantRedirect) this.requestStore(false);
        return true;
    }

    /** CTA 的 Button.ClickEvent 直接绑定这个方法。 */
    public DownloadFun(): void {
        if (!this.isSessionOwner) {
            this.session?.DownloadFun();
            return;
        }
        // Click 包中的 CTA 也必须服从全屏点击次数，避免按钮本身提前跳转。
        if (!this.allowsCtaRedirect) return;
        this.requestStoreAndEnd(false);
    }

    // 打开商店并沿用平台配置，允许调用方为主动点击开启重复跳转。
    public openStore(allowRepeat = false): boolean {
        if (!this.isSessionOwner) return this.session?.openStore(allowRepeat) ?? false;
        return this.requestStore(allowRepeat);
    }

    // 落版开始时停掉版本自己的点击和计时跳转，让视频先播完。
    public suspendAutomaticRedirects(): void {
        if (!this.isSessionOwner) {
            this.session?.suspendAutomaticRedirects();
            return;
        }
        this.gameStarted = false;
        this.clearTimeLimit();
        this.unbindScreenInput();
    }

    // 落版结束时打开商店并上报游戏结束。
    public redirectOnCountdownEnd(): void {
        if (!this.isSessionOwner) {
            this.session?.redirectOnCountdownEnd();
            return;
        }
        this.suspendAutomaticRedirects();
        this.requestStore(true);
        this.gameEnd();
    }

    /**
     * 游戏逻辑触发的自动跳转：Full 模式直接拦截，其它模式正常打开商店。
     * 与 openStore 的区别就是这道门禁；玩家主动点 CTA 请用 openStore / DownloadFun。
     */
    public autoRedirect(): boolean {
        if (!this.isSessionOwner) return this.session?.autoRedirect() ?? false;
        if (!this.allowsAutoRedirect) return false;
        return this.requestStore(false);
    }

    public resetSession(): void {
        if (!this.isSessionOwner) {
            this.session?.resetSession();
            return;
        }
        this.unbindScreenInput();
        this.clearTimeLimit();
        this.screenClickCount = 0;
        this.gameStarted = false;
        this.readySent = false;
        this.startSent = false;
        this.endSent = false;
        this.downloadOpened = false;
        if (this.autoStartGame) {
            this.ready();
            this.gameStart();
        }
    }

    private bindLifecycleEvents(): void {
        this.node.on(PLAYABLE_GAME_START_EVENT, this.gameStart, this);
        this.node.on(PLAYABLE_GAME_END_EVENT, this.gameEnd, this);
        if (!this.isSessionOwner) return;
        const host = browserWindow();
        host?.addEventListener(PLAYABLE_GAME_START_EVENT, this.onWindowGameStart);
        host?.addEventListener(PLAYABLE_GAME_END_EVENT, this.onWindowGameEnd);
    }

    private unbindLifecycleEvents(): void {
        this.node.off(PLAYABLE_GAME_START_EVENT, this.gameStart, this);
        this.node.off(PLAYABLE_GAME_END_EVENT, this.gameEnd, this);
        if (!this.isSessionOwner) return;
        const host = browserWindow();
        host?.removeEventListener(PLAYABLE_GAME_START_EVENT, this.onWindowGameStart);
        host?.removeEventListener(PLAYABLE_GAME_END_EVENT, this.onWindowGameEnd);
    }

    private installGlobalApi(): void {
        const host = browserWindow();
        if (!host) return;
        const api: PlayableVariantGlobalApi = {
            get mode() { return PlayableVariantKit.instance?.mode || PlayableRedirectMode.Full; },
            get allowsAutoRedirect() { return PlayableVariantKit.instance?.allowsAutoRedirect ?? false; },
            get allowsCtaRedirect() { return PlayableVariantKit.instance?.allowsCtaRedirect ?? true; },
            get isStoreOpened() { return PlayableVariantKit.instance?.isStoreOpened ?? false; },
            ready: () => this.ready(),
            gameStart: () => this.gameStart(),
            gameEnd: () => this.gameEnd(),
            openStore: () => this.openStore(),
            autoRedirect: () => this.autoRedirect(),
            download: () => {
                if (!this.allowsCtaRedirect) return false;
                return this.requestStoreAndEnd(false);
            },
            resetSession: () => this.resetSession(),
        };
        this.installedGlobalApi = api;
        host.PlayableVariantKit = api;
    }

    private configureBridgeUrls(): void {
        const host = browserWindow();
        const bridge = host?.super_html;
        if (!bridge) return;
        const urls = this.resolveStoreUrls();
        if (urls.android) bridge.google_play_url = urls.android;
        if (urls.ios) bridge.appstore_url = urls.ios;
    }

    private resolveStoreUrls(): { android: string; ios: string } {
        const injected = browserWindow()?.__PLAYABLE_VARIANT_CONFIG__;
        return {
            android: this.androidUrl.trim() || injected?.androidUrl?.trim() || '',
            ios: this.iosUrl.trim() || injected?.iosUrl?.trim() || '',
        };
    }

    private currentStoreUrl(): string {
        const urls = this.resolveStoreUrls();
        return sys.os === sys.OS.IOS ? urls.ios : urls.android;
    }

    private requestStoreAndEnd(allowRepeat: boolean): boolean {
        if (!this.requestStore(allowRepeat)) return false;
        this.gameEnd();
        return true;
    }

    // 按渠道打开当前设备的商店，并根据调用场景控制重复跳转。
    private requestStore(allowRepeat: boolean): boolean {
        const storeUrl = this.currentStoreUrl();
        if (!storeUrl) {
            console.error('[PlayableVariantKit] 当前平台的商店链接为空。');
            return false;
        }
        if (!allowRepeat && this.downloadOpened) return false;
        this.downloadOpened = true;

        const host = browserWindow();
        if (!host) return false;
        if (host.super_html_channel === 'applovin') {
            if (typeof host.mraid?.open === 'function') {
                host.mraid.open(storeUrl);
            } else {
                this.openStoreInNewTab(host, storeUrl);
            }
        } else if (host.super_html?.download) host.super_html.download(storeUrl);
        else if (host.mraid?.open) host.mraid.open(storeUrl);
        else host.open(storeUrl, '_blank', 'noopener,noreferrer');
        return true;
    }

    // 在普通浏览器里从 AppLovin 试玩包新开商店标签页。
    private openStoreInNewTab(host: Window, storeUrl: string): void {
        let tab: Window | null = null;
        try {
            tab = host.open(storeUrl, '_blank');
            if (tab) tab.opener = null;
        } catch {
            // 部分 WebView 无法调用 window.open，尝试打开新标签页链接。
        }
        if (tab) return;

        const link = host.document.createElement('a');
        link.href = storeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        host.document.body.appendChild(link);
        link.click();
        link.remove();
    }

    private bindScreenInput(): void {
        if (!this.isSessionOwner || this.screenInputBound || this.clickThreshold <= 0) return;
        this.screenInputBound = true;
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    private unbindScreenInput(): void {
        if (!this.screenInputBound) return;
        this.screenInputBound = false;
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    private readonly onTouchEnd = (): void => {
        this.lastTouchEndAt = Date.now();
        this.recordScreenClick();
    };

    private readonly onMouseUp = (): void => {
        if (Date.now() - this.lastTouchEndAt <= SYNTHETIC_MOUSE_EVENT_WINDOW_MS) return;
        this.recordScreenClick();
    };

    private recordScreenClick(): void {
        if (!this.gameStarted || this.clickThreshold <= 0) return;
        this.screenClickCount += 1;
        if (this.screenClickCount >= this.clickThreshold) this.requestStoreAndEnd(true);
    }

    /**
     * 时间版本：在 gameStart 时启动一次性计时，到点后打开商店并上报 game_end。
     * 玩家已经通过 CTA 打开过商店时不会重复弹出。
     */
    private startTimeLimit(): void {
        this.clearTimeLimit();
        if (this.timeLimitMs <= 0) return;
        this.redirectTimer = setTimeout(() => {
            this.redirectTimer = null;
            if (!this.gameStarted) return;
            this.requestStoreAndEnd(false);
        }, this.timeLimitMs);
    }

    private clearTimeLimit(): void {
        if (this.redirectTimer === null) return;
        clearTimeout(this.redirectTimer);
        this.redirectTimer = null;
    }

    private readonly onWindowGameStart = (): void => { this.gameStart(); };
    private readonly onWindowGameEnd = (): void => { this.gameEnd(); };
}
