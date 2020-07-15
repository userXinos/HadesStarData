'use strict';

const fs = require('fs');
const prettier = require('prettier');
const path = require('path');
const fsPromises = require('fs').promises;

global.ignoringHeaders = ['maxLevel', 'Name', 'TID', 'TID_Description', 'Icon', 'SlotType', 'Model'];
const pathCSVs = path.join(__dirname, '/rawData/');
const pathSave = path.join(__dirname, '/data/');
const pluginsPath = path.join(__dirname, '/plugins/');
const isWhiteListBS = require(pluginsPath + 'modification/fixValue.js').isWhiteListBS;
const isHide = require(pluginsPath + 'modification/fixValue.js').isHide;
const dataByTypes = require(pluginsPath + 'modification/byTypes.js');
const fixValue = require(pluginsPath + 'modification/fixValue.js');
const optionalFiles = ['projectiles.csv', 'ship_spawners.csv', 'solar_system_gen_data.csv']
    .map((e) => path.join(pathCSVs, e));
const startTime = new Date().getTime();
let files = process.argv.slice(2);

if (!files.length) {
  wipeDir(pathSave); // подготовить папку для новых файлов
  files = walk(pathCSVs)
      .filter((e) => (e != undefined && !optionalFiles.includes(e) && e.endsWith('.csv')));

  // рекурсивная читалка директории
  function walk(dir) {
    let results = [];
    fs.readdirSync(dir)
        .forEach((file) => {
          file = path.join(dir, '/', file);
          const stat = fs.statSync(file);
          if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
          } else {
            results.push(file);
          }
        });
    return results;
  }
  // рекурсивная удалялка директории
  function wipeDir(dir) {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        const curDir = path.join(dir, file);
        if (fs.lstatSync(curDir).isDirectory()) {
          wipeDir(curDir);
        } else {
          fs.unlinkSync(curDir);
        }
      });
      fs.rmdirSync(dir);
    }
  }
}
const plugins = fs.readdirSync(pluginsPath)
    .filter((e) => e.endsWith('.js'))
    .map((e) => e.replace(/(.*)\..+/, '$1'));

const promises = files.map(loadSaveFile);
Promise.all(promises)
    .then(() => {
      const time = (new Date().getTime() - startTime) / 1000;
      console.log(`Готово! (${time} сек.)`);
    })
    .catch((error) => {
      console.log(`Ошибки в выполнении. \n ${error} ${error.stack}`);
    });

function loadSaveFile(file) {
  return fsPromises.readFile(file, 'utf8')
      .then((data) => {
        const headers = (file.includes('loc_strings_')) ? ['key', 'value'] : undefined; // TODO избавиться от харкода
        let json = CSVtoJSON(data, headers);
        let pluginName = file
            .replace(/.*\/(.+)\.csv/, '$1');
        pluginName = plugins
            .find(((e) => pluginName.includes(e)));
        Object.defineProperty(json,
            'metadata', { // скрытый объект от перебора
              configurable: true,
              writable: true,
              value: {
                originalFile: file,
                saveAs: path.join(
                    pathSave,
                    path.relative(pathCSVs, file).replace(/csv$/, 'js'),
                ),
                pluginName: null,
              },
            });

        if (pluginName) {
          json = require(path.join(pluginsPath, '/', pluginName) + '.js')(
              require(__filename),
              json,
          );
          json.metadata.pluginName = pluginName;
          // plugins.splice(plugins.indexOf(pluginName), 1);
        }
        return saveFile(fixOrder(json));
      })
      .catch((err) => {
        throw err;
      });
}
function saveFile(json) {
  const addData = addContent(json);
  const pluginName = (json.metadata.pluginName)? `+ ${json.metadata.pluginName}.js plugin` : '';
  const file = json.metadata.saveAs;
  let parser = 'babel';
  delete json.metadata;
  let content = `
      // generated by ${path.relative(__dirname, __filename)} ${pluginName}
      // at ${new Date().toDateString()}

      let data = ${JSON.stringify(json, null, 2)}

      ${addData.content || ''}

      module.exports = {${addData.export}}
      `;

  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file));
  }
  if (file.split('.').pop() == 'json') {
    content = JSON.stringify(json, null, 2);
    parser = 'json';
  }
  return fsPromises.writeFile(
      file,
      prettier.format(content, {
        parser: parser,
        trailingComma: 'es5',
        printWidth: 410, // чтоб массивы выстраивались в одну линию
      }))
      .then(() => console.log(`Файл "${file}" создан`))
      .then(() => 'done')
      .catch((err) => {
        throw err;
      });

  // добавить захардкоженый контент
  function addContent(json) {
    const needData = json.metadata.originalFile.replace(/.*\/(.+)\..+$/, '$1');
    const byType = dataByTypes[needData] || {};
    const result = {};
    let registered = [];

    result.export = 'data';
    if (json[Object.keys(json)[0]].constructor !== NestedRawJson) {
      return result; // нет вложенных объектов - просто данные
    }
    Object.keys(byType)
        .forEach((key) => registered = registered.concat(byType[key]));
    const notRegistered = Object.keys(json)
        .filter((key) => !registered.includes(key));
    if (notRegistered.length != 0) {
      if (Object.keys(byType).length != 0) {
        byType.notregistered = notRegistered;
      } else {
        byType.default = notRegistered;
      }
    }
    result.content = `let byTypes= ${JSON.stringify(byType, null, 2)}`;
    result.export += ', byTypes';
    return result;
  }
}
function readCSV(file) {
  return CSVtoJSON(fs.readFileSync(`${pathCSVs + file}.csv`, 'utf8'));
}
// парсер из таблицы в обектJS
function CSVtoJSON(csv, headers) {
  const regexSplitStr = new RegExp(',(?!\\s)');
  const data = csv.split('\n');
  if (!headers) headers = data[0].split(regexSplitStr);
  const jsonObj = new RawJson();
  let name = null;

  if (headers.length == 1) return simpleArray(data);
  for (let i = 1; i < data.length; i++) {
    const string = data[i].split(regexSplitStr);

    if (string == '') continue;
    if (string[0] !== '') {
      name = string[0];
      jsonObj[name] = new NestedRawJson();
      jsonObj[name].maxLevel = 1;
    } else {
      jsonObj[name].maxLevel++;
    }
    for (let j = 0; j < string.length; j++) {
      const header = headers[j].trim();
      let value = string[j].trim();
      const stockValue = jsonObj[name][header];

      if (isTrashHeader(header) || value === undefined || value === '') continue;
      value = fixValue(name, header, value);
      if (value == null) continue;
      if (stockValue == undefined || stockValue === '') {
        jsonObj[name][header] = value;
      } else if (Array.isArray(stockValue)) {
        jsonObj[name][header].push(value);
      } else {
        jsonObj[name][header] = [];
        jsonObj[name][header].push(stockValue, value);
      }
    }
  }
  return removeDupsFromArrays(jsonObj);

  // глобально скрытые значения - не имеют важности
  function isTrashHeader(str) {
    const trashHeaders = JSON.parse(fs.readFileSync(`${pluginsPath}modification/trashHeaders.json`, 'utf8').toLowerCase());
    const whiteList = ['WeaponFx']; // нужен только для modules, а все FX удаляются

    if (whiteList.includes(str)) return false;
    str = str.toLowerCase();
    return (trashHeaders.includes(str) || str.startsWith('is') || str.includes('fx'));
  }
  // массив, сравнивать i и i+1, если все элементы равны установить вместо массива i[0] || {key:[1,1,1,1]} => {key:1}
  function removeDupsFromArrays(obj) {
    if (obj.constructor == NestedRawJson) {
      Object.keys(obj).forEach((key) => {
        const item = obj[key];
        if (!Array.isArray(item)) return;
        const isAllDups = item.every((v) => v === item[0]);
        if (isAllDups) obj[key] = item[0];
      });
      return obj;
    } else {
      Object.keys(obj).forEach((k) => {
        obj[k] = removeDupsFromArrays(obj[k]);
      });
      return obj;
    }
  }
  // если не таблица, а просто данные в столбик
  function simpleArray(array) {
    const result = new RawJson();

    result.array = array
        .filter((e) => !(e === ''))
        .map((e) => fixValue(null, null, e));
    result.maxLevel = result.array.length;
    return result;
  }
}
// главный класс
class RawJson extends Object {}
// исправление порядка объекта
function fixOrder(obj) {
  const headers = JSON.parse(fs.readFileSync(`${pluginsPath}modification/headersOrder.json`, 'utf8'));

  if (obj.constructor == RawJson || obj.constructor == NestedRawJson || obj.constructor == Object) {
    const indexes = []; // создание объекта с ключами + индекс
    for (const key in obj) {
      const elem = {};
      elem.index = (headers.includes(key)) ? headers.indexOf(key) : 666;
      elem.key = key;
      indexes.push(elem);
    }
    indexes.sort((a, b) => a.index - b.index);

    // сборка готового объекта
    const result = Object.create(obj);
    for (const i in indexes) {
      result[indexes[i].key] = fixOrder(obj[indexes[i].key]);
    }
    return result;
  } else {
    return obj;
  }
}
// вложенные объекты в главном
class NestedRawJson extends Object {
  // заполнить пространство для соответствия уровню
  fillSpace(spaceSymbol = 0, method = 'unshift') {
    const obj = this;

    for (const i of Object.keys(obj)) {
      if (ignoringHeaders.includes(i) || !Array.isArray(obj[i])) continue;
      while (obj[i].length < obj.maxLevel) {
        obj[i][method](spaceSymbol);
      }
    }
    return obj;
  }
  // столкнуть 2 массива в один, разделитель - "!"
  pushArrays(newName, key1, key2) {
    const obj = this;
    obj[newName] = [];
    for (let i = 0; i < obj.maxLevel; i++) {
      obj[newName].push(`${obj[key1][i]}!${obj[key2][i]}`);
    }
    [key1, key2].forEach((e) => delete obj[e]);
    return obj;
  }
  combineWith(obj) {
    return combineObjects(this, obj);
  }
}
function combineObjects(obj1, obj2) {
  for (const p in obj2) {
    try {
      if (ignoringHeaders.includes(p)) continue;
      if (obj2[p].constructor == Object) {
        obj1[p] = combineObjects(obj1[p], obj2[p]);
      } else {
        obj1[p] = obj2[p];
      }
    } catch (e) {
      obj1[p] = obj2[p];
    }
  }
  return obj1;
}
function renameKeys(obj, newKeys) {
  const keyValues = Object.keys(obj).map((key) => {
    const newKey = newKeys[key] || key;
    return {[newKey]: obj[key]};
  });
  return Object.assign({}, ...keyValues);
}
// из кучи объеков в один
function compileOne(obj) {
  const copyObj = Object.assign({}, obj);

  Object.keys(obj).forEach((key) => {
    delete obj[key];
    const obj1 = copyObj[key];

    for (let k in obj1) {
      const value = obj1[k];
      k = k.replace(/\s+/g, ''); // напр "Credit Storage"
      const stockValue = obj[k];

      if (stockValue == undefined || stockValue === '') {
        obj[k] = value;
      } else if (Array.isArray(stockValue)) {
        obj[k].push(value);
      } else {
        obj[k] = [];
        obj[k].push(stockValue, value);
      }
    }
  });
  obj.maxLevel = obj.maxLevel.length;
  return obj;
}

module.exports = {
  combineObjects,
  renameKeys,
  compileOne,
  isHide,
  fixValue,
  dataByTypes,
  readCSV,
  isWhiteListBS,
  RawJson,
  NestedRawJson,
};
