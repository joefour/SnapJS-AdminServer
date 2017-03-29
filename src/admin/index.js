'use strict';

import express from 'express';
import compose from 'composable-middleware';
import mongoose from 'mongoose';
import * as controller from './admin.controller';
import authServer from 'snapmobile-authserver';

var User;
var auth;

export const router = express.Router();

const attachClass = function() {
  return compose()
    .use((req, res, next) => {
      if (mongoose.modelNames().indexOf(req.params.className) === -1) {
        res.status(404).end(JSON.stringify(
          { errors:
            { error:
              { message: 'Could not find class: ' + req.params.className }
          }
        }));
      }

      req.class = mongoose.model(req.params.className);
      next();
    });
};

/**
 * Sets the User class of Admin and its dependencies for reference
 * @param {User} _user An instance of the User class
 */
export function setUser(_user) {
  User = _user;

  authServer.setUser(User);
  auth = authServer.authService;

  /**
   * Admin routes for CMS
   */
  router.get('/:className/schema', auth.hasRole('admin'), attachClass(), controller.getSchema);
  router.post('/:className/deleteMultiple', auth.hasRole('admin'),
    attachClass(), controller.destroyMultiple);
  router.post('/:className/importFromCsv', auth.hasRole('admin'),
    attachClass(), controller.importFromCsv);

  router.get('/:className/', auth.hasRole('admin'), attachClass(), controller.index);
  router.get('/:className/:id', auth.hasRole('admin'), attachClass(), controller.show);
  router.post('/:className/', auth.hasRole('admin'), attachClass(), controller.create);
  router.put('/:className/:id', auth.hasRole('admin'), attachClass(), controller.update);
  router.patch('/:className/:id', auth.hasRole('admin'), attachClass(), controller.update);
  router.delete('/:className/:id', auth.hasRole('admin'), attachClass(), controller.destroy);
}

/**
 * Sets the Utils class of Admin and its dependencies for reference
 * @param {Utils} _utils An instance of the Utils class
 */
export function setUtils(_utils) {
  controller.setUtils(_utils);
}
