import { _decorator, AudioClip, AudioSource, Component, Node } from 'cc';

const { ccclass, property, disallowMultiple } = _decorator;

@ccclass('GameAudio')
@disallowMultiple(true)
export class GameAudio extends Component {
    @property({ type: AudioClip, tooltip: '绑定首次点击或触摸屏幕后循环播放的背景音乐。' })
    private backgroundMusic: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定玩家拼出一个新单词时播放的答对音效。' })
    private correctSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定礼花粒子开始播放时触发的庆祝音效。' })
    private celebrationSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定玩家拼错或重复提交单词时播放的答错音效。' })
    private wrongSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定玩家答对时随猫咪开心动画播放的音效。' })
    private catHappySound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定玩家答错时随猫咪沮丧动画播放的音效。' })
    private catSadSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定整局游戏进入失败结算时播放的音效。' })
    private defeatSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '绑定玩家点按或滑动选中字母时播放的音效。' })
    private letterSound: AudioClip | null = null;

    private source: AudioSource;
    private unlocked = false;
    private introPending = false;

    // 准备可循环播放的音源，保持开局静音。
    protected onLoad(): void {
        this.source = this.addComponent(AudioSource);
        this.source.playOnAwake = false;
        this.source.loop = true;
        this.source.clip = this.backgroundMusic;
    }

    // 捕获首次有效手势，重新启用时在开场结束后恢复背景音乐。
    protected onEnable(): void {
        if (this.unlocked) {
            if (this.backgroundMusic && !this.introPending) {
                this.source.play();
            }
        } else {
            this.node.on(Node.EventType.TOUCH_END, this.unlockAudio, this, true);
        }
    }

    // 停用时移除触摸监听并停止背景音乐。
    protected onDisable(): void {
        this.node.off(Node.EventType.TOUCH_END, this.unlockAudio, this, true);
        if (this.unlocked && this.backgroundMusic) {
            this.source.stop();
        }
    }

    // 播放选中字母的音效。
    public playLetter(): void {
        this.playEffect(this.letterSound);
    }

    // 根据判题结果同时播放答题提示音和对应的猫咪情绪音效。
    public playAnswer(correct: boolean): void {
        this.playEffect(correct ? this.correctSound : this.wrongSound);
        this.playEffect(correct ? this.catHappySound : this.catSadSound);
    }

    // 在礼花粒子开始播放时触发庆祝音效。
    public playCelebration(): void {
        this.playEffect(this.celebrationSound);
    }

    // 播放整局失败的结算音效。
    public playDefeat(): void {
        this.playEffect(this.defeatSound);
    }

    // 开场期间推迟背景音乐，开场结束后恢复已解锁的音频。
    public setIntroPending(pending: boolean): void {
        this.introPending = pending;
        if (!pending && this.unlocked && this.enabledInHierarchy && this.backgroundMusic) {
            this.source.play();
        }
    }

    // 在首次有效手势时解锁音频，游戏就绪后才循环播放背景音乐。
    public unlockAudio(): void {
        if (this.unlocked) return;
        this.node.off(Node.EventType.TOUCH_END, this.unlockAudio, this, true);
        this.unlocked = true;
        if (this.backgroundMusic && !this.introPending) {
            this.source.play();
        }
    }

    // 仅在音频已解锁且当前组件启用时播放已绑定的音效。
    private playEffect(clip: AudioClip | null): void {
        if (this.unlocked && !this.introPending && this.enabledInHierarchy && clip) {
            this.source.playOneShot(clip);
        }
    }
}
