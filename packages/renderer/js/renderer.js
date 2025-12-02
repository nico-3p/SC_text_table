// 保存されたデータが入る配列
let voiceData = [];
let viewData = [];

let grid;

const getAssets = async () => {
    const input_filter = document.getElementById('input_filter');
    const input_getcount = document.getElementById('input_getcount');
    const input_input_downloadAssetMap = document.getElementById('input_downloadAssetMap');

    const filterStr = input_filter.value;
    const getCount = input_getcount.value;
    const shouldDownloadAssetMap = input_input_downloadAssetMap.checked;

    console.log(filterStr + getCount);

    window.electronAPI.getAssets(filterStr, getCount, shouldDownloadAssetMap);

    // console.log(res);
};

const searchDataMain = () => {
    viewData = false;

    const inputSearchList = [...document.querySelectorAll('.input-search')];

    for (elem of inputSearchList) {
        const str = elem.value;
        const key = elem.dataset.key;

        viewData = searchData(str, key, viewData);
    }

    console.log(viewData);

    updateTable();
    // return retArr;
};

const searchData = (str, key, arr = false) => {
    if (!arr) arr = voiceData;
    if (str == '') return arr;

    const regex = RegExp(str);

    const retArr = arr.filter((value) => regex.test(value[key]));

    return retArr;
};

// ====

const updateTable = () => {
    grid.updateConfig({
        data: viewData,
    }).forceRender();
};

// ====

const downloadAudio = (src, name) => {
    window.electronAPI.downloadAudio(src, name);
};

// ====

const addEvent = () => {
    // main.jsからログを受け取る
    window.electronAPI.onGetLog((_event, value) => {
        console.log(value);
        document.title = String(value);
    });

    // GetAssetsボタンが押された時、main.jsにアセット取得を指示
    const input_getbutton = document.getElementById('input_getbutton');
    input_getbutton.addEventListener('click', getAssets, false);

    // CreateJSONボタンが押された時、main.jsにJSONファイイル生成を指示
    const input_createJSON = document.getElementById('input_createJSON');
    input_createJSON.addEventListener(
        'click',
        () => {
            window.electronAPI.createJSON();
        },
        false
    );

    // LoadJSONボタンが押された時、JSONファイイルからデータを取得
    const input_loadJSON = document.getElementById('input_loadJSON');
    input_loadJSON.addEventListener(
        'click',
        async () => {
            document.title = 'loadJSON - start';

            voiceData = await window.electronAPI.loadJSON();

            document.title = 'loadJSON - end';

            console.log(voiceData);
        },
        false
    );

    // 検索欄が変更された時、データ検索処理の開始
    const idList = ['input_id', 'input_speaker', 'input_text', 'input_audio', 'input_json'];
    for (id of idList) {
        const elem = document.getElementById(id);
        elem.addEventListener('change', searchDataMain, false);
    }
};

const createTable = () => {
    const tableContainer = document.getElementById('tableContainer');
    grid = new gridjs.Grid({
        columns: [
            {
                id: 'id',
                name: 'id',
            },
            {
                id: 'speaker',
                name: 'speaker',
            },
            {
                id: 'text',
                name: 'text',
            },
            {
                id: 'audio',
                name: '▷',
                width: '72px',
                formatter: (cell) => {
                    return gridjs.h(
                        'a',
                        {
                            href: cell,
                            target: '_blank',
                            style: {
                                color: '#000',
                            },
                        },
                        '▷'
                    );
                },
            },
            {
                id: 'audio',
                name: '↓',
                width: '72px',
                formatter: (cell, row) => {
                    // return gridjs.html(`<a href="${cell}" target="_blank">▷</a><button data-src="${cell}" data-name="${row.cells[2]}" onClick="downloadAudio">↓</button>`)
                    return gridjs.h(
                        'a',
                        {
                            style: {
                                cursor: 'pointer',
                                // 'color': '-webkit-link',
                                'text-decoration': 'underline',
                            },
                            onClick: () => {
                                const speaker = row.cells[1].data;
                                const text = row.cells[2].data;
                                const id = row.cells[0].data;

                                downloadAudio(cell, `${speaker}_${text} [${id}]`);
                            },
                        },
                        '↓'
                    );
                },
            },
            {
                id: 'json',
                name: 'json',
                formatter: (cell, row) => {
                    return gridjs.h(
                        'a',
                        {
                            style: {
                                cursor: 'pointer',
                                // 'color': '-webkit-link',
                                'text-decoration': 'underline',
                            },
                            onClick: () => {
                                console.log(cell);
                                window.electronAPI.openViewer(cell);
                            },
                        },
                        cell
                    );
                },
            },
        ],
        pagination: {
            limit: 100,
        },
        resizable: true,
        sort: true,
        fixedHeader: true,
        data: [],
        style: {
            table: {
                'font-size': '12px',
                'table-layout': 'auto',
            },
            td: {
                padding: '2px 24px',
            },
        },
    }).render(tableContainer);
};

const init = () => {
    addEvent();
    createTable();
};
init();
