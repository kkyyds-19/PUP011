import { _decorator, Component, Label, Sprite, SpriteFrame, resources } from 'cc';
import { LocalizationMgr } from './localizationMgr';
const { ccclass, property } = _decorator;

@ccclass('Localizer')
export class Localizer extends Component {

    @property({ tooltip: '是否为图片本地化：true 使用图片，false 使用文本' })
    public isImage = true;

    @property({ tooltip: '图片资源名前缀（留空则使用节点名称）' })
    public imageName = '';

    @property({ tooltip: '本地化文本 Key（对应语言表中的键，isImage 为 false 时生效）' })
    public textKey = '';

    private sprite: Sprite | null = null;
    private label: Label | null = null;
    private seq = 0;
    private destroyed = false;

    start() {
        this.sprite = this.getComponent(Sprite);
        this.label = this.getComponent(Label);

        if (this.sprite) this.sprite.enabled = false;
        if (this.label && this.textKey && !LocalizationMgr.instance.isReady) {
            this.label.string = '';
        }

        LocalizationMgr.instance.registerLocalizer(
            this.node.uuid,
            this.applyLanguage.bind(this)
        );
    }

    onDestroy() {
        this.destroyed = true;
        LocalizationMgr.instance.unregisterLocalizer(this.node.uuid);
    }

    private applyLanguage(lang: string): void {
        if (this.isImage) {
            this.applySprite(lang);
        } else {
            this.applyText();
        }
    }

    // ================= 文本 =================
    private applyText(): void {
        if (!this.label || !this.textKey) return;
        this.label.string = LocalizationMgr.instance.t(this.textKey);
    }

    // ================= 图片 =================
    private async applySprite(lang: string): Promise<void> {
        if (!this.sprite) return;

        const prefix = this.imageName || this.node.name;
        const seq = ++this.seq;

        const paths = this.buildPaths(prefix, lang);

        for (const p of paths) {
            const sf = await this.load(p);
            if (this.destroyed || seq !== this.seq) return;

            if (sf) {
                this.sprite.spriteFrame = sf;
                this.sprite.enabled = true;
                return;
            }
        }
    }

    private load(path: string): Promise<SpriteFrame | null> {
        return new Promise(res => {
            resources.load(path, SpriteFrame, (err, sf) => {
                res(err ? null : sf);
            });
        });
    }

    private buildPaths(prefix: string, lang: string): string[] {
        const list: string[] = [];
        const push = (l: string) =>
            list.push(`i18n/texture/${prefix}_${l}/spriteFrame`);
        // 保留你的业务规则（德语代码已统一为 de）
        if (prefix === 'logo' && (lang === 'de' || lang === 'fr')) {
            push('en');
            return list;
        }

        push(lang);
        if (lang !== 'en') push('en');

        return list;
    }
}
