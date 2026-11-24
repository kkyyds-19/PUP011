import { _decorator, Component, sys, JsonAsset, director, Node, resources, EventTarget } from 'cc';
const { ccclass } = _decorator;

/**
 * 临时强制语言：填 null 表示走自动检测（URL ?lang= 优先，其次设备语言）；
 * 调试时填 'en' / 'zh-CN' 等可强制某一种语言。
 */
const DEBUG_FORCE_LANGUAGE: string | null = 'en';
const _notification = new EventTarget();

@ccclass('LocalizationMgr')
export class LocalizationMgr extends Component {

    private static _instance: LocalizationMgr | null = null;
    private static readonly STORAGE_KEY = 'Localization.Language';
    public static readonly EVENT_LANGUAGE_CHANGED = 'LocalizationMgr:LanguageChanged';

    private _language = 'en';
    private _dict: Record<string, string> = Object.create(null);
    private _localizers = new Map<string, (lang: string) => void>();
    private _ready = false;

    /** 支持的语言（资源文件为 i18n/{code}.json，取不到时回落 en） */
    private _supportedLanguages = [
        'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de',
        'fr', 'es', 'ar', 'ur', 'hi', 'bn', 'tr',
        'ru', 'ms', 'pt', 'id', 'ne', 'it',
    ];

    // ================= 单例 =================
    static get instance(): LocalizationMgr {
        if (this._instance && this._instance.isValid) return this._instance;

        const scene = director.getScene();
        const host = scene?.getChildByName('__LocalizationMgr__') ?? new Node('__LocalizationMgr__');
        scene?.addChild(host);

        this._instance = host.getComponent(LocalizationMgr) ?? host.addComponent(LocalizationMgr);
        return this._instance;
    }

    get language(): string {
        return this._language;
    }

    get isReady(): boolean {
        return this._ready;
    }

    protected onLoad(): void {
        if ((this as any).__inited) return;
        (this as any).__inited = true;

        this.initLanguage();
    }

    // ================= 初始化语言 =================
    private async initLanguage(): Promise<void> {

        if (DEBUG_FORCE_LANGUAGE) {
            await this.setLanguage(DEBUG_FORCE_LANGUAGE);
            return;
        }

        // 1️⃣ URL ?lang=
        const urlLang = this.getLangFromUrl();
        if (urlLang) {
            await this.setLanguage(urlLang);
            return;
        }

        // 2️⃣ AppLovin / 系统语言
        const detected = this.detectDeviceLanguage();
        await this.setLanguage(detected);
    }

    /**
     * 从 URL 参数获取语言
     * 支持 ?lang=zh-CN 或 ?lang=en 格式
     */
    private getLangFromUrl(): string | null {
        try {
            if (typeof window === 'undefined' || !window.location) return null;
            
            const langParam = this.getUrlParam('lang');
            if (!langParam) return null;
            
            const langLower = langParam.toLowerCase();
            
            // 直接匹配映射表
            if (LocalizationMgr.URL_LANG_MAP[langLower]) {
                const result = LocalizationMgr.URL_LANG_MAP[langLower];
                return result;
            }
            
            // 尝试匹配语言前缀（如 zh-Hans-CN -> zh）
            const langPrefix = langLower.split('-')[0];
            if (LocalizationMgr.URL_LANG_MAP[langPrefix]) {
                const result = LocalizationMgr.URL_LANG_MAP[langPrefix];
                return result;
            }
            
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 兼容性获取 URL 参数（不依赖 URLSearchParams）
     */
    private getUrlParam(name: string): string | null {
        try {
            const search = window.location.search;
            if (!search) return null;
            
            const query = search.substring(1); // 去掉 '?'
            const pairs = query.split('&');
            
            for (const pair of pairs) {
                const [key, value] = pair.split('=');
                if (decodeURIComponent(key) === name) {
                    return value ? decodeURIComponent(value) : '';
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    // ================= 设置语言 =================
    async setLanguage(input: string): Promise<void> {
        const lang = this.matchSupported(this.normalizeLang(input)) ?? 'en';

        if (this._language === lang && Object.keys(this._dict).length) return;

        this._language = lang;
        this._ready = false;
        // Safari 无痕 / ITP 防追踪会禁用 localStorage，访问会抛 SecurityError，
        // 必须包住，否则语言初始化在 Safari 上直接中断、所有本地化文本变空
        try {
            sys.localStorage.setItem(LocalizationMgr.STORAGE_KEY, lang);
        } catch (e) {
            console.warn('[LocalizationMgr] 本地存储不可用，跳过语言持久化', e);
        }

        await this.loadDictionary(lang);

        this._ready = true;
        _notification.emit(LocalizationMgr.EVENT_LANGUAGE_CHANGED, lang);
        this.applyAll(lang);
    }

    // ================= 字典 =================
    private loadDictionary(lang: string): Promise<void> {
        return new Promise(resolve => {
            resources.load(`i18n/${lang}`, JsonAsset, (err, asset) => {
                if (!err && asset?.json) {
                    this._dict = asset.json as any;
                    resolve();
                } else if (lang !== 'en') {
                    resources.load('i18n/en', JsonAsset, (_, asset2) => {
                        this._dict = asset2?.json ?? {};
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    t(key: string): string {
        return this._dict[key] ?? key;
    }

    // ================= 语言处理 =================
    /** URL 语言参数映射表（key 为小写，可带地区后缀；均为 → 资源文件名） */
    private static readonly URL_LANG_MAP: Record<string, string> = {
        // 英语
        'en': 'en', 'en-us': 'en', 'en-gb': 'en', 'en-au': 'en', 'en-ca': 'en',
        // 简中 / 繁中（zh 泛匹配走简中）
        'zh': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-sg': 'zh-CN', 'zh-hans': 'zh-CN', 'zh-hans-cn': 'zh-CN',
        'zh-tw': 'zh-TW', 'zh-hk': 'zh-TW', 'zh-mo': 'zh-TW', 'zh-hant': 'zh-TW',
        // 日 / 韩
        'ja': 'ja', 'ja-jp': 'ja',
        'ko': 'ko', 'ko-kr': 'ko',
        // 德（ge 为历史参数，兼容保留）
        'de': 'de', 'de-de': 'de', 'de-at': 'de', 'de-ch': 'de', 'ge': 'de',
        // 法 / 西 / 意 / 葡
        'fr': 'fr', 'fr-fr': 'fr', 'fr-ca': 'fr',
        'es': 'es', 'es-es': 'es', 'es-mx': 'es', 'es-ar': 'es', 'es-419': 'es',
        'it': 'it', 'it-it': 'it',
        'pt': 'pt', 'pt-br': 'pt', 'pt-pt': 'pt',
        // 阿拉伯 / 乌尔都 / 印地 / 孟加拉 / 尼泊尔
        'ar': 'ar', 'ar-sa': 'ar', 'ar-ae': 'ar', 'ar-eg': 'ar',
        'ur': 'ur', 'ur-pk': 'ur',
        'hi': 'hi', 'hi-in': 'hi',
        'bn': 'bn', 'bn-bd': 'bn', 'bn-in': 'bn',
        'ne': 'ne', 'ne-np': 'ne',
        // 土耳其 / 俄 / 马来 / 印尼（in 为印尼语历史代码）
        'tr': 'tr', 'tr-tr': 'tr',
        'ru': 'ru', 'ru-ru': 'ru',
        'ms': 'ms', 'ms-my': 'ms',
        'id': 'id', 'id-id': 'id', 'in': 'id',
    };

    private normalizeLang(lang: string): string {
        const l = lang.toLowerCase();
        
        // 1. 直接匹配映射表
        if (LocalizationMgr.URL_LANG_MAP[l]) {
            return LocalizationMgr.URL_LANG_MAP[l];
        }
        
        // 2. 尝试匹配语言前缀（如 zh-Hans-CN -> zh）
        const prefix = l.split('-')[0];
        if (LocalizationMgr.URL_LANG_MAP[prefix]) {
            return LocalizationMgr.URL_LANG_MAP[prefix];
        }
        
        // 3. 兜底：zh 系列默认简中，其余无法识别一律回落英语
        if (l.startsWith('zh')) return 'zh-CN';

        return 'en';
    }

    private matchSupported(lang: string): string | null {
        return this._supportedLanguages.indexOf(lang) !== -1 ? lang : null;
    }

    private detectDeviceLanguage(): string {
        const navLang = navigator?.language;
        return navLang ? navLang : 'en';
    }

    // ================= Localizer =================
    registerLocalizer(id: string, fn: (lang: string) => void): void {
        this._localizers.set(id, fn);
        if (this._ready) {
            fn(this._language);
        }
    }

    unregisterLocalizer(id: string): void {
        this._localizers.delete(id);
    }

    private applyAll(lang: string): void {
        this._localizers.forEach(fn => fn(lang));
    }
}
