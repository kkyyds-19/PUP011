import { _decorator, Component, UITransform, Vec3, VideoPlayer, sys, view } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('VideoPlayOnTouch')
export class VideoPlayOnTouch extends Component {
    @property({ type: UITransform, tooltip: '绑定 Canvas 的 UITransform，用于将视频对齐到画布中心。' })
    private canvas: UITransform | null = null;

    @property({ tooltip: '视频元数据就绪前使用的默认宽高比，当前落版素材为 2:3。' })
    private videoAspect = 2 / 3;

    private video: VideoPlayer | null = null;
    private dom: HTMLVideoElement | null = null;
    private lastWidth = 0;
    private lastHeight = 0;
    private lastAspect = 0;

    // 启用时取消引擎的原始尺寸回写，由本组件负责等比适配。
    protected onEnable(): void {
        this.video = this.getComponent(VideoPlayer);
        if (this.video) {
            this.video.keepAspectRatio = false;
        }
        this.lastWidth = 0;
        this.fitToScreen();
    }

    // 检查视频元数据和可视区变化，继续适配播放中及停在最后一帧的画面。
    protected update(): void {
        this.fitToScreen();
    }

    // 配置移动端内联播放和点击穿透，并读取已创建的视频元素。
    private getVideoElement(): HTMLVideoElement | null {
        const dom = sys.isBrowser ? this.video?.nativeVideo ?? null : null;
        if (dom && dom !== this.dom) {
            dom.playsInline = true;
            dom.setAttribute('webkit-playsinline', 'true');
            dom.setAttribute('x5-video-player-type', 'h5-page');
            dom.setAttribute('x5-video-player-fullscreen', 'false');
            dom.style.pointerEvents = 'none';
        }
        this.dom = dom;
        return dom;
    }

    // 使用真实视频比例将画面等比缩放到可视区内，并居中到 Canvas。
    private fitToScreen(): void {
        if (!this.video) {
            return;
        }
        const { width, height } = view.getVisibleSize();
        const dom = this.getVideoElement();
        const aspect = dom?.videoWidth && dom.videoHeight
            ? dom.videoWidth / dom.videoHeight
            : this.videoAspect > 0 ? this.videoAspect : 2 / 3;
        if (width <= 0 || height <= 0
            || (width === this.lastWidth && height === this.lastHeight && aspect === this.lastAspect)) {
            return;
        }
        this.lastWidth = width;
        this.lastHeight = height;
        this.lastAspect = aspect;

        const fitWidth = Math.min(width, height * aspect);
        this.getComponent(UITransform).setContentSize(fitWidth, fitWidth / aspect);
        const parent = this.node.parent?.getComponent(UITransform);
        if (this.canvas && parent) {
            const center = this.canvas.convertToWorldSpaceAR(new Vec3(
                this.canvas.width * (0.5 - this.canvas.anchorX),
                this.canvas.height * (0.5 - this.canvas.anchorY),
                0,
            ));
            const local = parent.convertToNodeSpaceAR(center);
            this.node.setPosition(local.x, local.y, 0);
        }
    }
}
