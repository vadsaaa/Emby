define(['events', 'browser', 'pluginManager', 'apphost', 'appSettings'], function (events, browser, pluginManager, appHost, appSettings) {
    "use strict";

    return function () {

        var self = this;

        self.name = 'Html Audio Player';
        self.type = 'mediaplayer';
        self.id = 'htmlaudioplayer';

        // Let any players created by plugins take priority
        self.priority = 1;

        var mediaElement;
        var currentSrc;

        function getSavedVolume() {
            return appSettings.get("volume") || 1;
        }

        function saveVolume(value) {
            if (value) {
                appSettings.set("volume", value);
            }
        }

        self.canPlayMediaType = function (mediaType) {

            return (mediaType || '').toLowerCase() === 'audio';
        };

        self.getDeviceProfile = function () {

            return new Promise(function (resolve, reject) {

                require(['browserdeviceprofile'], function (profileBuilder) {

                    var profile = profileBuilder({
                    });
                    resolve(profile);
                });
            });
        };

        self.currentSrc = function () {
            return currentSrc;
        };

        self.play = function (options) {

            var elem = createMediaElement();

            var val = options.url;

            elem.crossOrigin = getCrossOriginValue(options.mediaSource);
            elem.title = options.title;

            // Opera TV guidelines suggest using source elements, so let's do that if we have a valid mimeType
            if (options.mimeType && browser.operaTv) {

                // Need to do this or we won't be able to restart a new stream
                if (elem.currentSrc) {
                    elem.src = '';
                    elem.removeAttribute('src');
                }

                elem.innerHTML = '<source src="' + val + '" type="' + options.mimeType + '">';
            } else {
                elem.src = val;
            }

            currentSrc = val;

            // Chrome now returns a promise
            var promise = elem.play();

            if (promise && promise.then) {
                return promise;
            }
            return Promise.resolve();
        };

        function getCrossOriginValue(mediaSource) {

            return 'anonymous';
        }

        // Save this for when playback stops, because querying the time at that point might return 0
        self.currentTime = function (val) {

            if (mediaElement) {
                if (val != null) {
                    mediaElement.currentTime = val / 1000;
                    return;
                }

                return (mediaElement.currentTime || 0) * 1000;
            }
        };

        self.duration = function (val) {

            if (mediaElement) {
                var duration = mediaElement.duration;
                if (duration && !isNaN(duration) && duration !== Number.POSITIVE_INFINITY && duration !== Number.NEGATIVE_INFINITY) {
                    return duration * 1000;
                }
            }

            return null;
        };

        function supportsFade() {

            if (browser.tv) {
                // Not working on tizen. 
                // We could possibly enable on other tv's, but all smart tv browsers tend to be pretty primitive
                return false;
            }

            return true;
        }

        self.stop = function (destroyPlayer) {

            cancelFadeTimeout();

            var elem = mediaElement;
            var src = currentSrc;

            if (elem && src) {

                if (!destroyPlayer || !supportsFade()) {

                    if (!elem.paused) {
                        elem.pause();
                    }
                    elem.src = '';
                    elem.innerHTML = '';
                    elem.removeAttribute("src");
                    onEnded();
                    return Promise.resolve();
                }

                var originalVolume = elem.volume;

                return fade(elem, function () {

                }).then(function () {
                    if (!elem.paused) {
                        elem.pause();
                    }
                    elem.src = '';
                    elem.innerHTML = '';
                    elem.removeAttribute("src");

                    elem.volume = originalVolume;
                    onEnded();
                });
            }
            return Promise.resolve();
        };

        self.destroy = function () {

        };

        var fadeTimeout;

        function fade(elem) {

            var newVolume = Math.max(0, elem.volume - 0.15);
            console.log('fading volume to ' + newVolume);
            elem.volume = newVolume;

            if (!elem.volume) {
                return Promise.resolve();
            }

            return new Promise(function (resolve, reject) {

                cancelFadeTimeout();

                fadeTimeout = setTimeout(function () {
                    fade(elem).then(resolve, reject);
                }, 100);
            });
        }

        function cancelFadeTimeout() {
            var timeout = fadeTimeout;
            if (timeout) {
                clearTimeout(timeout);
                fadeTimeout = null;
            }
        }

        self.pause = function () {
            if (mediaElement) {
                mediaElement.pause();
            }
        };

        // This is a retry after error
        self.resume = function () {
            if (mediaElement) {
                mediaElement.play();
            }
        };

        self.unpause = function () {
            if (mediaElement) {
                mediaElement.play();
            }
        };

        self.paused = function () {

            if (mediaElement) {
                return mediaElement.paused;
            }

            return false;
        };

        self.setVolume = function (val) {
            if (mediaElement) {
                mediaElement.volume = val / 100;
            }
        };

        self.getVolume = function () {
            if (mediaElement) {
                return mediaElement.volume * 100;
            }
        };

        self.volumeUp = function () {
            self.setVolume(Math.min(self.getVolume() + 2, 100));
        };

        self.volumeDown = function () {
            self.setVolume(Math.max(self.getVolume() - 2, 0));
        };

        self.setMute = function (mute) {

            if (mediaElement) {
                mediaElement.muted = mute;
            }
        };

        self.isMuted = function () {
            if (mediaElement) {
                return mediaElement.muted;
            }
            return false;
        };

        function onEnded() {

            var stopInfo = {
                src: currentSrc
            };

            events.trigger(self, 'stopped', [stopInfo]);
            currentSrc = null;
        }

        function onTimeUpdate() {

            events.trigger(self, 'timeupdate');
        }

        function onVolumeChange() {

            if (!fadeTimeout) {
                saveVolume(this.volume);
                events.trigger(self, 'volumechange');
            }
        }

        function onPlaying() {

            events.trigger(self, 'playing');
        }

        function onPause() {
            events.trigger(self, 'pause');
        }

        function onError() {

            var errorCode = this.error ? this.error.code : '';
            errorCode = (errorCode || '').toString();
            console.log('Media element error code: ' + errorCode);

            var type;

            switch (errorCode) {
                case 1:
                    // MEDIA_ERR_ABORTED
                    // This will trigger when changing media while something is playing
                    return;
                case 2:
                    // MEDIA_ERR_NETWORK
                    type = 'network';
                    break;
                case 3:
                    // MEDIA_ERR_DECODE
                    break;
                case 4:
                    // MEDIA_ERR_SRC_NOT_SUPPORTED
                    break;
            }

            //events.trigger(self, 'error', [
            //{
            //    type: type
            //}]);
        }

        function createMediaElement() {

            var elem = document.querySelector('.mediaPlayerAudio');

            if (!elem) {
                elem = document.createElement('audio');
                elem.classList.add('mediaPlayerAudio');
                elem.classList.add('hide');

                document.body.appendChild(elem);

                elem.volume = getSavedVolume();

                elem.addEventListener('timeupdate', onTimeUpdate);
                elem.addEventListener('ended', onEnded);
                elem.addEventListener('volumechange', onVolumeChange);
                elem.addEventListener('pause', onPause);
                elem.addEventListener('playing', onPlaying);
                elem.addEventListener('error', onError);
            }

            mediaElement = elem;

            return elem;
        }

        function onDocumentClick() {
            document.removeEventListener('click', onDocumentClick);

            var elem = document.createElement('audio');
            elem.classList.add('mediaPlayerAudio');
            elem.classList.add('hide');

            document.body.appendChild(elem);

            elem.src = pluginManager.mapPath(self, 'blank.mp3');
            elem.play();

            setTimeout(function () {
                elem.src = '';
                elem.removeAttribute("src");
            }, 1000);
        }

        // Mobile browsers don't allow autoplay, so this is a nice workaround
        if (!appHost.supports('htmlaudioautoplay')) {
            document.addEventListener('click', onDocumentClick);
        }
    };
});