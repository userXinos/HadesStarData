"use strict";
const main = require('../generateGameData.js')
const globals = require('./globals.js')

let shipsData = main.readCSV('capital_ships')
let projectilesData = main.readCSV('projectiles')
let artifacts = main.readCSV('artifacts')
let globalsData = globals.default(main.readCSV('globals'))
let starHeaders = ['EffectDurationx10', 'ActivationDelay', 'ActivationPrep', 'MaxDPSTime', 'APTPIOTTP', 'DisableTime'];

exports.default = function (obj) {
  for (let key in obj) {
    let obj1 = obj[key]

    // добавить глобальные к модулям 
    Object.keys(globalsData).forEach(e => {
      if (e.includes(key)) {
        obj1[e] = globalsData[e]
      }
    })
    // добавить ур. артефакта
    if (!obj1.Hide) {
      for (let key2 in artifacts) {
        let art = artifacts[key2]
        if (!art.BlueprintTypes) continue;
        let types = art.BlueprintTypes.split('!')
        if (art.MaxModuleLevelToAward == obj1.AwardLevel && types.includes(obj1.SlotType)) {
          obj1.TID_Artifact = art.TID
        }
      }
    }
    // добавить projectiles к ракетоподобным 
    if (obj1.WeaponEffectType == 'projectile') {
      obj[key] = main.combineObjects(obj1, projectilesData[obj1.WeaponFx]);
    }
    // добавить данные дронов
    if (obj1.SpawnLifetime) {
      obj[key] = main.combineObjects(obj1, shipsData[obj1.Name]);
    }
    ['WeaponEffectType', 'WeaponFx', 'Hide'].forEach(e => delete obj1[e]);
  }
  ['Recoil', 'Immolation', 'EMPRocket'].forEach(e => obj[e].ShowWSInfo = 1);
  addStarInfo(obj, starHeaders, 'WS');
  addStarInfo(obj, starHeaders, 'BS');
  obj.TimeWarp.Icon = 'Mod_TimeWarp_Icon' // ошибка в таблице, 'w' в иконках в верхнем регистре 
  obj.MiningBoost.WhiteStarScore.unshift(0) // ошибка в таблице, не хватает "0"
  obj.Destiny.WhiteStarScore.unshift(0) // ошибка в таблице, не хватает "0"
  obj.MiningDrone.MiningSpeed = [29.1, 33.3, 37.5, 41.7, 45.8, 52.2, 58.8, 65.2, 74.1, 85.7]; // хз как считать это
  return obj;
}
// фикс модулей, добавление БЗ/ГЗ стат
function addStarInfo(obj, starHeaders, star) {
  let isHide = main.isHide
  let coefficient = (v) => (star == 'WS') ? v * 600 : v * 2

  for (let name in obj) {
    let module = obj[name]
    let check = obj[name][`Show${star}Info`]

    delete obj[name][`Show${star}Info`]
    if (check != 1) continue
    for (let stata in module) {
      if (starHeaders.includes(stata)) {
        if (star == 'BS' && !main.isWhiteListBS(stata, name)) continue; // пока тлоько для ГЗ
        if (!Object.keys(module).includes(stata + star)) {
          let value = module[stata]
          if (!Array.isArray(value)) {
            obj[name][stata + star] = coefficient(value);
          } else if (Array.isArray(value)) {
            obj[name][stata + star] = value.map(e => {
              return coefficient(e)
            })
          }
          if (isHide(name, stata, true)) delete obj[name][stata]; // удалить оригинальную стату, если не нужна
        }
      }
    }
  }
}
function fixGlobals(obj) {
  for (let i of Object.keys(obj)) {
    obj[i] = obj[i]['Value']
  }
  return obj
}