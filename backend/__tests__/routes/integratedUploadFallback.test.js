const express = require('express');
const request = require('supertest');
const photos = [
  {id:1, source_filename:'admin.JPG', original_filename:'admin.JPG', uploaded_by:'admin', source_origin:'managed', media_type:'image'},
  {id:2, source_filename:'guest.JPG', original_filename:'guest.JPG', uploaded_by:'guest', source_origin:'managed', media_type:'image'},
  {id:3, source_filename:'camera.JPG', original_filename:'camera.JPG', source_origin:'external', media_type:'image'},
];
jest.mock('../../src/database/db', () => ({ db: () => {
  const query = {where:()=>query, first:async()=>({id:7}), select:()=>query, orderBy:()=>query, limit:()=>query,
    offset:async()=>[{id:1},{id:2},{id:3}], count:()=>({first:async()=>({count:3})})};
  return query;
}, logActivity:jest.fn() }));
jest.mock('../../src/middleware/integratedBridgeAuth', () => ({ integratedBridgeAuth:(req,res,next)=>{req.admin={id:1};next();} }));
jest.mock('../../src/middleware/permissions', () => ({requirePermission:()=> (req,res,next)=>next()}));
jest.mock('../../src/services/photoExportService', () => ({PhotoExportService:class {async getPhotosWithFeedback(){return photos;}}}));
jest.mock('../../src/services/retouchSelectionService', () => ({getBridgeSelectionState:async()=>new Map()}));
jest.mock('../../src/services/markMerge', () => ({mergeMarks:()=>({})}));
jest.mock('../../src/services/storage', () => ({getStorage:()=>({kind:()=> 'local'})}));
jest.mock('../../src/services/photoResolver', () => ({resolvePhotoStorageKey:(_event,photo)=>`events/active/project/${photo.source_filename}`}));
const app = express();
app.use('/bridge',require('../../src/routes/integratedBridge'));
test('managed photographer uploads expose fallback without changing RAW-first or guest contracts', async()=>{
  const res=await request(app).get('/bridge/events/7/photos');
  expect(res.status).toBe(200);
  expect(res.body.photos[0]).toMatchObject({upload_source_key:null,fallback_source_key:'events/active/project/admin.JPG'});
  expect(res.body.photos[1]).toMatchObject({upload_source_key:'events/active/project/guest.JPG',fallback_source_key:'events/active/project/guest.JPG'});
  expect(res.body.photos[2]).toMatchObject({upload_source_key:null,fallback_source_key:null});
});
