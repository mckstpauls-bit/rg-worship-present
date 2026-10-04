const stage = RGRender.createStage(document.getElementById('screen'));
stage.show({ mode: 'blank', cover: 'black', transition: { type: 'cut' } });
window.rg.on('output:render', (p) => stage.show(p));
