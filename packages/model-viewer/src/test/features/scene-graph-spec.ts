/* @license
 * Copyright 2020 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Mesh, MeshStandardMaterial} from 'three';

import {IS_IE11} from '../../constants.js';
import {SceneGraphInterface, SceneGraphMixin} from '../../features/scene-graph.js';
import ModelViewerElementBase, {$scene} from '../../model-viewer-base.js';
import {ModelScene} from '../../three-components/ModelScene.js';
import {assetPath, rafPasses, waitForEvent} from '../helpers.js';
import {BasicSpecTemplate} from '../templates.js';

const expect = chai.expect;

const ASTRONAUT_GLB_PATH = assetPath('models/Astronaut.glb');
const HORSE_GLB_PATH = assetPath('models/Horse.glb');

suite('ModelViewerElementBase with SceneGraphMixin', () => {
  if (IS_IE11) {
    // TODO(#999): Unskip this suite when we support IE11 in 3DOM
    console.warn('Skipping this suite for IE11 only');
    return;
  }

  let nextId = 0;
  let tagName: string;
  let ModelViewerElement:
      Constructor<ModelViewerElementBase&SceneGraphInterface>;
  let element: InstanceType<typeof ModelViewerElement>;

  setup(() => {
    tagName = `model-viewer-scene-graph-${nextId++}`;
    ModelViewerElement = class extends SceneGraphMixin
    (ModelViewerElementBase) {
      static get is() {
        return tagName;
      }
    };
    customElements.define(tagName, ModelViewerElement);

    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
  });

  teardown(() => {
    const {worklet} = element;

    if (worklet != null) {
      worklet.terminate();
    }

    document.body.removeChild(element);
  });

  BasicSpecTemplate(() => ModelViewerElement, () => tagName);

  suite('without a scene graph worklet script', () => {
    suite('with a loaded model', () => {
      setup(async () => {
        element.src = ASTRONAUT_GLB_PATH;

        await waitForEvent(element, 'load');
        await rafPasses();
      });

      test('does not activate a scene graph worklet', () => {
        expect(element.worklet).to.not.be.ok;
      });
    });
  });

  suite('scene export', () => {
    suite('with a loaded model', () => {
      setup(async () => {
        element.src = ASTRONAUT_GLB_PATH;

        await waitForEvent(element, 'load');
        await rafPasses();
      });

      test('exports the loaded model to GLTF', async () => {
        const exported = await element.exportScene({binary: false});
        console.log(exported.size);
        expect(exported).to.be.not.undefined;
        expect(exported.size).to.be.greaterThan(500);
      });

      test('exports the loaded model to GLB', async () => {
        const exported = await element.exportScene({binary: true});
        console.log(exported.size);
        expect(exported).to.be.not.undefined;
        expect(exported.size).to.be.greaterThan(500);
      });
    });
  });


  suite('with a scene graph worklet script', () => {
    test('eventually creates a new worklet', async () => {
      const script = document.createElement('script');
      script.type = 'experimental-scene-graph-worklet';
      script.textContent = 'console.log("Hello, worklet!");';

      element.appendChild(script);

      await waitForEvent(element, 'worklet-created');

      expect(element.worklet).to.be.ok;
    });

    suite('in an external script file', () => {
      test('eventually creates a new worklet', async () => {
        const scriptText = 'console.log("Hello, worklet!");';
        const url = URL.createObjectURL(
            new Blob([scriptText], {type: 'text/javascript'}));

        const script = document.createElement('script');
        script.type = 'experimental-scene-graph-worklet';
        script.src = url;

        try {
          element.appendChild(script);

          await waitForEvent(element, 'worklet-created');

          expect(element.worklet).to.be.ok;
        } finally {
          if (url != null) {
            URL.revokeObjectURL(url);
          }
        }
      });
    });

    suite('with a loaded model', () => {
      setup(async () => {
        element.src = ASTRONAUT_GLB_PATH;

        await waitForEvent(element, 'load');
        await rafPasses();
      });

      test('allows the scene graph to be manipulated', async () => {
        const scene = element[$scene] as ModelScene;

        const script = document.createElement('script');

        script.type = 'experimental-scene-graph-worklet';
        script.setAttribute('allow', 'material-properties; messaging');
        script.textContent = `
self.addEventListener('model-change', function() {
  model.materials[0].pbrMetallicRoughness.setBaseColorFactor([1, 0, 0, 1]).then(function() {
    self.postMessage('done');
  });
});
`;

        element.appendChild(script);

        await waitForEvent(element, 'worklet-created');

        await waitForEvent(element.worklet!, 'message');

        expect(
            ((scene.model.modelContainer.children[0].children[0].children[0] as
              Mesh)
                 .material as MeshStandardMaterial)
                .color)
            .to.include({r: 1, g: 0, b: 0});
      });

      test(
          'allows image.setURI to be called when "textures" is in capabilities',
          async () => {
            const script = document.createElement('script');
            script.type = 'experimental-scene-graph-worklet';
            script.setAttribute('allow', 'messaging; textures');
            script.textContent = `
self.addEventListener('model-change', function() {
  model.materials[0].pbrMetallicRoughness.baseColorTexture.texture.source.setURI(null).then(function() {
    self.postMessage('done');
  });
});
`;
            element.appendChild(script);
            await waitForEvent(element, 'worklet-created');
            await waitForEvent(element.worklet!, 'message');
            // No further checks needed. If the call is disallowed, we would
            // never get the 'message' event, thus failing via timeout.
          });

      suite('when the model changes', () => {
        test('updates when the model changes', async () => {
          const script = document.createElement('script');

          script.type = 'experimental-scene-graph-worklet';
          script.setAttribute('allow', 'material-properties; messaging');
          script.textContent = `
self.addEventListener('model-change', function() {
  self.postMessage(JSON.stringify(model.materials[0].pbrMetallicRoughness.baseColorFactor));
});
`;

          element.appendChild(script);

          await waitForEvent(element, 'worklet-created');

          const message =
              await waitForEvent<MessageEvent>(element.worklet!, 'message');

          expect(JSON.parse(message.data)).to.be.eql([0.5, 0.5, 0.5, 1]);

          const nextMessageArrives =
              waitForEvent<MessageEvent>(element.worklet!, 'message');

          element.src = HORSE_GLB_PATH;

          await waitForEvent(element, 'load');
          await rafPasses();

          const nextMessage = await nextMessageArrives;

          expect(JSON.parse(nextMessage.data)).to.be.eql([1, 1, 1, 1]);
        });
      });
    });
  });
});
