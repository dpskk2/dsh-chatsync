/**
 * dsh-chatsync 浏览器端 bundle
 *
 * - 侧栏导航「同步」入口:sidebar.panellist 与 main 原生面板,图标指示同步活动;
 *   阶段、耗时和操作反馈留在同步页内;
 * - 设置面板「同步」分节:同步速览与立即同步、同步设置、冲突内容和历史数据修复;
 *
 * 挂载方式:声明了 dsh.client 的依赖由 dsh 自动打包进浏览器 bundle,无需手工注入。
 */
// dsh-chatsync 浏览器端 bundle
window.__ModuleLoader__.load({
  id: '@dpskk2/dsh-chatsync',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react');
    const e = react.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = react;

