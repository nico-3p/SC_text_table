class Viewer {
    /**
     * @param {HTMLCanvasElement} canvas - The canvas element where the viewer will render.
     * @param {HTMLInputElement} seekBar - The seek bar element for controlling playback.
     */
    constructor(canvas, seekBar) {
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Invalid canvas element provided.');
        }

        if (!seekBar || !(seekBar instanceof HTMLInputElement)) {
            throw new Error('Invalid seek bar element provided.');
        }

        this.seekBar = seekBar;

        // Initialize PIXI Application
        this.app = new PIXI.Application({
            width: canvas.width,
            height: canvas.height,
            view: canvas,
        });

        // Set up the canvas and stage
        this.viewer = new SCDB.EventViewer();
        this.viewer.addTo(this.app.stage);

        this.playTrack();
    }

    async playTrack() {
        await this.loadTrack();
        this.start();
        this.viewer._toggleAutoplay();
    }

    async loadTrack() {
        this.locationParams = this._getCurrentUrlParams();

        if (!this.locationParams) {
            console.error('No URL parameters found.');
            return;
        }
        if (this.locationParams.eventId & this.locationParams.eventType) {
            const eventId = this.locationParams.eventId;
            const eventType = this.locationParams.eventType;

            await this.viewer.loadTrack(`https://${atob('dmlld2VyLnNoaW55Y29sb3JzLm1vZQ==')}/json/${eventType}/${eventId}.json`);
        } else if (this.locationParams.path) {
            const jsonPath = '../../../' + this.locationParams.path;

            await this.viewer.loadTrack(jsonPath);
        }

        // path

        this.croneTrack();
        this.initSeekBar();
    }

    start() {
        this.viewer.start();
    }

    croneTrack() {
        this.originalTrack = structuredClone(this.viewer.Track);

        const keysToDelete = ['waitType', 'waitTime', 'se', 'effectLabel', 'effectValue', 'effectTarget', 'bgEffect', 'bgEffectTime', 'voice'];

        this.noEffectTrack = structuredClone(this.viewer.Track).map((e) => {
            const clone = { ...e };
            for (const key of keysToDelete) {
                delete clone[key];
            }
            return clone;
        });
    }

    // -- Seek Track --

    initSeekBar() {
        this.seekBar.max = this.viewer.Track.length - 1;
        this.seekBar.min = 0;
        this.seekBar.value = 0;

        this.seekBar.addEventListener('change', () => {
            const seekValue = parseInt(this.seekBar.value, 10);
            this.goto(seekValue);
        });
        this.seekBar.addEventListener('mousedown', () => {
            this.isSeeking = true;
        });
        this.seekBar.addEventListener('mouseup', () => {
            this.isSeeking = false;
        });

        setInterval(() => {
            if (this.isSeeking) return; // Skip updating if seeking
            this.seekBar.value = this.viewer._current;
        }, 30);
    }

    goto(position) {
        // NOTE: 目的のシーンまでシークする場合、初めから再生しなければ効果が正しく適用されない

        if (position < 0 || position >= this.viewer.Track.length) {
            console.warn('Position out of bounds:', position);
            return;
        }

        // 効果などを取り除いたクローンに置き換え
        for (let i = 0; i < this.viewer.Track.length; i++) {
            this.viewer.Track[i] = structuredClone(this.noEffectTrack[i]);
        }

        // 強制的にエフェクト消去
        try {
            this.viewer._current = this.viewer.Track.length - 1;
            this.viewer._renderTrack();
        } catch (error) {
            console.log('Error rendering track:', error);
        }

        this.viewer._current = 0;

        // 目的の位置までトラックを再生
        let i = 0;
        while (this.viewer._current < position && i < this.viewer.Track.length) {
            this.viewer._renderTrack();
            i++;
        }

        // オリジナルのトラックに戻す
        for (let i = 0; i < this.viewer.Track.length; i++) {
            this.viewer.Track[i] = structuredClone(this.originalTrack[i]);
        }
        this.viewer._renderTrack();
    }

    // -- tools --

    _getCurrentUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const result = {};

        for (const key of params.keys()) {
            const values = params.getAll(key);
            result[key] = values.length > 1 ? values : values[0];
        }

        return result;
    }
}

(async () => {
    const canvas = document.getElementById('viewer_canvas');
    const seekBar = document.getElementById('seek_bar');
    const viewer = new Viewer(canvas, seekBar);
})();
