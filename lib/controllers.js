'use strict';

const co = require('co');
const getAtom = require('selenium-atoms').getByName;
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const logger = require('./logger');

const ELEMENT_OFFSET = 1000;

const implicitWaitForCondition = function(func) {
  return _.waitForCondition(func, this.implicitWaitMs);
};

const sendJSCommand = function *(atom, args, inDefaultFrame) {
  let frames = !inDefaultFrame && this.frame ? [this.frame] : [];
  let atomScript = getAtom(atom);
  let script;
  if (frames.length) {
    let elem = getAtom('get_element_from_cache');
    let frame = frames[0];
    script = `(function (window) { var document = window.document;
      return (${atomScript}); })((${elem.toString('utf8')})(${JSON.stringify(frame)}))`;
  } else {
    script = `(${atomScript})`;
  }
  const command = `${script}(${args.map(JSON.stringify).join(',')})`;
  var res = yield this.page.evaluate(command);

  if (res.value) {
    return res.value;
  }

  try {
    return JSON.parse(res).value;
  } catch (e) {
    return null;
  }
};

const convertAtoms2Element = function(atoms) {
  const atomsId = atoms && atoms.ELEMENT;

  if (!atomsId) {
    return null;
  }

  const index = this.atoms.push(atomsId) - 1;

  return {
    ELEMENT: index + ELEMENT_OFFSET
  };
};

const convertElement2Atoms = function(elementId) {
  if (!elementId) {
    return null;
  }

  let atomsId;

  try {
    atomsId = this.atoms[parseInt(elementId, 10) - ELEMENT_OFFSET];
  } catch (e) {
    return null;
  }

  return {
    ELEMENT: atomsId
  };
};

const findElementOrElements = function *(strategy, selector, ctx, many) {
  let result;
  const that = this;

  const atomsElement = convertElement2Atoms.call(this, ctx);

  function *search() {
    result = yield sendJSCommand.call(that, `find_element${many ? 's' : ''}`, [
      strategy,
      selector,
      atomsElement
    ]);
    return _.size(result) > 0;
  }

  try {
    yield implicitWaitForCondition.call(this, co.wrap(search));
  } catch (err) {
    result = [];
  }

  if (many) {
    return result.map(convertAtoms2Element.bind(this));
  } else {
    if (!result || _.size(result) === 0) {
      throw new errors.NoSuchElement();
    }
    return convertAtoms2Element.call(this, result);
  }
};

const controllers = {};

/**
 * Change focus to another frame on the page.
 *
 * @module setFrame
 * @param {string} frame Identifier(id/name) for the frame to change focus to
 * @returns {Promise}
 */
controllers.setFrame = function *(frame) {
  if (!frame) {
    this.frame = null;
    logger.debug('Back to default content');
    return null;
  }

  if (frame.ELEMENT) {
    let atomsElement = convertElement2Atoms.call(this, frame.ELEMENT);
    let result = yield sendJSCommand.call(this, 'get_frame_window', [atomsElement]);
    logger.debug(`Entering into web frame: '${result.WINDOW}'`);
    this.frame = result.WINDOW;
    return null;
  } else {
    let atom = _.isNumber(frame) ? 'frame_by_index' : 'frame_by_id_or_name';
    let result = yield sendJSCommand.call(this, atom, [frame]);
    if (!result || !result.WINDOW) {
      throw new errors.NoSuchFrame();
    }
    logger.debug(`Entering into web frame: '${result.WINDOW}'`);
    this.frame = result.WINDOW;
    return null;
  }
};

/**
 * Click on an element.
 *
 * @module click
 * @returns {Promise}
 */
controllers.click = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendJSCommand.call(this, 'click', [atomsElement]);
};

/**
 * Search for an element on the page, starting from the document root.
 * @module findElement
 * @param {string} strategy The type
 * @param {string} using The locator strategy to use.
 * @param {string} value The search target.
 * @returns {Promise.<Element>}
 */
controllers.findElement = function *(strategy, selector, ctx) {
  return yield findElementOrElements.call(this, strategy, selector, ctx, false);
};

controllers.findElements = function *(strategy, selector, ctx) {
  return yield findElementOrElements.call(this, strategy, selector, ctx, true);
};

/**
 * Returns the visible text for the element.
 *
 * @module getText
 * @returns {Promise.<string>}
 */
controllers.getText = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendJSCommand.call(this, 'get_text', [atomsElement]);
};

/**
 * Clear a TEXTAREA or text INPUT element's value.
 *
 * @module clearText
 * @returns {Promise.<string>}
 */
controllers.clearText = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendJSCommand.call(this, 'clear', [atomsElement]);
};

/**
 * Set element's value.
 *
 * @module setValue
 * @param elementId
 * @param value
 * @returns {Promise.<string>}
 */
controllers.setValue = function *(elementId, value) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  yield sendJSCommand.call(this, 'click', [atomsElement]);
  return yield sendJSCommand.call(this, 'type', [atomsElement, value]);
};

/**
 * Determine if an element is currently displayed.
 *
 * @module isDisplayed
 * @returns {Promise.<string>}
 */
controllers.isDisplayed = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendJSCommand.call(this, 'is_displayed', [atomsElement]);
};

/**
 * Get the value of an element's property.
 *
 * @module getProperty
 * @returns {Promise.<string>}
 */
controllers.getProperty = function *(elementId, attrName) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendJSCommand.call(this, 'get_attribute_value', [
    atomsElement,
    attrName
  ]);
};

/**
 * Get the current page title.
 *
 * @module title
 * @returns {Promise.<Object>}
 */
controllers.title = function *() {
  return yield this.page.title();
};

/**
 * Inject a snippet of JavaScript into the page for execution in the context of the currently selected frame.
 *
 * @module execute
 * @param code script
 * @param [args] script argument array
 * @returns {Promise.<string>}
 */
controllers.execute = function *(script, args) {
  if (!args) {
    args = [];
  }

  // args = args.map(arg => {
  //   if (arg.ELEMENT) {
  //     return convertElement2Atoms.call(this, arg.ELEMENT);
  //   } else {
  //     return arg;
  //   }
  // });

  const value = yield sendJSCommand.call(this, 'execute_script', [
    script,
    args
  ], true);

  if (Array.isArray(value)) {
    return value.map(convertAtoms2Element.bind(this));
  } else {
    return value;
  }
};

/**
 * Retrieve the URL of the current page.
 *
 * @module url
 * @returns {Promise.<string>}
 */
controllers.url = function *() {
  return yield this.page.url();
};

/**
 * Navigate to a new URL.
 *
 * @module get
 * @param url get a new url.
 * @returns {Promise.<string>}
 */
controllers.get = function *(url) {
  this.frame = null;
  yield this.page.goto(url, {
    waitUntil: 'load' || 'networkidle'
  });
  return null;
};

/**
 * Navigate forwards in the browser history, if possible.
 *
 * @module forward
 * @returns {Promise.<string>}
 */
controllers.forward = function *() {
  this.frame = null;
  yield this.page.goForward();
  return null;
};

/**
 * Navigate backwards in the browser history, if possible.
 *
 * @module back
 * @returns {Promise.<string>}
 */
controllers.back = function *() {
  this.frame = null;
  yield this.page.goBack();
  return null;
};

/**
 * Get all window handlers.
 *
 * @module back
 * @returns {Promise}
 */
controllers.getWindows = function *() {
  return yield this.page.frames();
};

controllers.setWindow = function *(windowHandle) {
  throw new errors.NotImplementedError();
};

/**
 * Get the size of the specified window.
 *
 * @module setWindowSize
 * @param [handle] window handle to set size for (optional, default: 'current')
 * @returns {Promise.<string>}
 */
controllers.setWindowSize = function *(windowHandle, width, height) {
  yield this.page.setViewport({
    width: width,
    height: height,
    hasTouch: true,
    deviceScaleFactor: this.args.deviceScaleFactor || 1
  });
  return null;
};

/**
 * Maximize the specified window if not already maximized.
 *
 * @module maximize
 * @param handle window handle
 * @returns {Promise.<string>}
 */
controllers.maximize = function *(windowHandle) {
  return yield this.setWindowSize(windowHandle, 1280, 800);
};

/**
 * Refresh the current page.
 *
 * @module refresh
 * @returns {Promise.<string>}
 */
controllers.refresh = function *() {
  this.frame = null;
  return yield this.page.reload();
};

/**
 * Get the current page source.
 *
 * @module getSource
 * @returns {Promise.<string>}
 */
controllers.getSource = function *() {
  const cmd = `return document.getElementsByTagName('html')[0].outerHTML`;
  return yield this.execute(cmd);
};

/**
 * Take a screenshot of the current page.
 *
 * @module getScreenshot
 * @returns {Promise.<string>} The screenshot as a base64 encoded PNG.
 */
controllers.getScreenshot = function *() {
  var image = yield this.page.screenshot({
    fullPage: true
  });
  let base64 = image.toString('base64');
  return base64;
  //let dir = path.join(process.cwd(), data.dir);
  //_.mkdir(path.dirname(dir));
  //fs.writeFileSync(dir, img.toString('binary'), 'binary');
};

/**
 * Query the value of an element's computed CSS property.
 *
 * @module getComputedCss
 * @returns {Promise.<string>}
 */
controllers.getComputedCss = function *(elementId, propertyName) {
  return yield this.execute('return window.getComputedStyle(arguments[0], null).getPropertyValue(arguments[1]);', [
    convertElement2Atoms.call(this, elementId),
    propertyName
  ]);
};

/**
 * Returns all cookies associated with the address of the current browsing context’s active document.
 *
 * @module getAllCookies
 * @returns {Promise.<string>}
 */
controllers.getAllCookies = function *() {
  return yield this.page.cookies();
};

/**
 * Returns the cookie with the requested name from the associated cookies in the cookie store of the current browsing context’s active document. If no cookie is found, a no such cookie error is returned.
 *
 * @module getNamedCookie
 * @returns {Promise.<string>}
 */
controllers.getNamedCookie = function *(name) {
  return yield this.page.cookies();
};

/**
 * Adds a single cookie to the cookie store associated with the active document’s address.
 *
 * @module addCookie
 * @returns {Promise.<string>}
 */
controllers.addCookie = function *(cookie) {
  yield this.page.setCookie(cookie);
  return null;
};

/**
 * Delete either a single cookie by parameter name, or all the cookies associated with the active document’s address if name is undefined.
 *
 * @module deleteCookie
 * @returns {Promise.<string>}
 */
controllers.deleteCookie = function *(cookie) {
  return yield this.page.deleteCookie(cookie);
};

/**
 * Delete All Cookies command allows deletion of all cookies associated with the active document’s address.
 *
 * @module deleteAllCookies
 * @returns {Promise.<string>}
 */
controllers.deleteAllCookies = function *() {
  return yield this.page.deleteCookie();
};

module.exports = controllers;
