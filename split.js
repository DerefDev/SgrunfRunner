const PASSWORD_CORRETTA = "FUTURO";

document.addEventListener('DOMContentLoaded', () => {
    const fantasyTile = document.getElementById('tile-fantasy');
    const secretInput = document.getElementById('secret-input');
    const cyberpunkSection = document.getElementById('cyberpunk-section');
    const splitContainer = document.getElementById('split-container');

    const isTouch = window.matchMedia("(pointer: coarse)").matches;

    function setupNavigation(clickTarget, url) {
        clickTarget.addEventListener('click', () => {
            window.open(url, '_blank');
        });
    }

    function updateLayout() {
        const useRow = window.innerWidth > window.innerHeight;
        splitContainer.style.flexDirection = useRow ? 'row' : 'column';
    }

    updateLayout();
    window.addEventListener('resize', updateLayout);

    setupNavigation(fantasyTile, 'ModalitaFantasy/index.html');

    if (!isTouch) {
        document.querySelectorAll('video').forEach(video => {
            video.load();
        });

        document.querySelectorAll('.split-tile, .secret-content').forEach(tile => {
            const video = tile.querySelector('video');
            tile.addEventListener('mouseenter', () => {
                if (video) video.play().catch(() => {});
            });
            tile.addEventListener('mouseleave', () => {
                if (video) {
                    video.pause();
                    video.currentTime = 0;
                }
            });
        });
    }

    secretInput.addEventListener('keyup', (e) => {
        const value = secretInput.value.toUpperCase();

        if (e.key === 'Enter' || value === PASSWORD_CORRETTA) {
            if (value === PASSWORD_CORRETTA) {
                cyberpunkSection.classList.remove('locked');
                cyberpunkSection.classList.add('unlocked');
                cyberpunkSection.style.justifyContent = 'flex-start';
                secretInput.blur();
                setupNavigation(cyberpunkSection, 'ModalitaCyberpunk/index.html');
            } else if (e.key === 'Enter') {
                secretInput.style.borderColor = 'red';
                setTimeout(() => { secretInput.style.borderColor = '#00e5ff'; }, 500);
                secretInput.value = '';
            }
        }
    });
});