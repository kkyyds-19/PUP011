import { _decorator, Component, Label, RichText } from 'cc';
import { LocalizationMgr } from '../Language/localizationMgr';

const { ccclass } = _decorator;
const COUNT_PLACEHOLDER = '{remaining}';
const TITLE_KEY = 'wordChallenge.title';
const SINGULAR_TITLE_KEY = 'wordChallenge.titleOne';
const PROMPT_KEY = 'wordChallenge.prompt';

@ccclass('LanguageConfig')
export class LanguageConfig extends Component {
    private remainingWords = 25;
    private localization: LocalizationMgr;
    private rightToLeft = false;

    // 订阅语言变化，让本地化资源加载后刷新标题。
    protected start(): void {
        this.localization = LocalizationMgr.instance;
        this.localization.registerLocalizer(this.uuid, this.onLanguageChanged.bind(this));
    }

    // 组件销毁时取消标题的语言订阅。
    protected onDestroy(): void {
        this.localization?.unregisterLocalizer(this.uuid);
    }

    // 更新剩余词数，并用当前语言重新渲染标题。
    public setRemainingWords(remaining: number): void {
        this.remainingWords = remaining;
        this.render();
    }

    // 切换标题的文字方向，再应用新语言的文案。
    private onLanguageChanged(language: string): void {
        this.rightToLeft = language === 'ar' || language === 'ur';
        this.render();
    }

    // 渲染三行标题，让剩余数字保持红色、问句保持金色。
    private render(): void {
        let title = this.getComponent(RichText);
        if (!title) {
            const label = this.getComponent(Label);
            if (label) {
                label.enabled = false;
            }
            title = this.addComponent(RichText);
            title.horizontalAlign = RichText.HorizontalAlign.CENTER;
            title.fontSize = 52;
            title.lineHeight = 56;
            title.handleTouchEvent = false;
        }
        const singular = this.remainingWords === 1 ? this.localization?.t(SINGULAR_TITLE_KEY) : null;
        const localized = singular && singular !== SINGULAR_TITLE_KEY
            ? singular
            : this.localization?.t(TITLE_KEY);
        const fallback = this.remainingWords === 1
            ? `the last ${COUNT_PLACEHOLDER} word`
            : `all ${COUNT_PLACEHOLDER} words`;
        const template = localized && localized !== TITLE_KEY
            ? localized
            : `Only sharp minds find\n${fallback}`;
        const prompt = this.localization?.t(PROMPT_KEY);
        const question = prompt && prompt !== PROMPT_KEY ? prompt : 'Can you?';
        const lines = template.split('\n').map(line => this.formatTitleLine(line));
        const direction = this.rightToLeft ? '\u200F' : '';
        title.string = `<b>${lines.join('\n')}\n<size=48><color=#E9C38A>${direction}${question}${direction}</color></size></b>`;
    }

    // 将数字替换为红色富文本，并为从右到左阅读的语言调整绘制顺序。
    private formatTitleLine(line: string): string {
        const [before, after] = line.split(COUNT_PLACEHOLDER);
        const direction = this.rightToLeft ? '\u200F' : '';
        if (after === undefined) {
            return `<color=#FFFFFF>${direction}${line}${direction}</color>`;
        }
        const count = `<size=60><color=#FF3B3F>${this.remainingWords}</color></size>`;
        const first = this.rightToLeft ? after : before;
        const last = this.rightToLeft ? before : after;
        return `<color=#FFFFFF>${direction}${first}${direction}</color>${count}<color=#FFFFFF>${direction}${last}${direction}</color>`;
    }
}

