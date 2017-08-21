import L from 'leaflet'
import { uniq } from 'lodash'
import { getTilesForBbox, getTileUrlSuffix, parseSegmentId } from '../lib/tiles'
import { getRoute } from '../lib/valhalla'
import { merge } from '../lib/geojson'
import { setDataSource, getCurrentScene, setCurrentScene } from '../lib/tangram'
import { fetchDataTiles } from './data'
import store from '../store'
import { startLoading, stopLoading } from '../store/actions/loading'

const OSMLR_TILE_PATH = 'https://osmlr-tiles.s3.amazonaws.com/v0.1/geojson/'
const host = 'routing-prod.opentraffic.io'

function getSuffixes (bbox) {
  const tiles = getTilesForBbox(bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat)
  // Filter out tiles with level 2, no data for those
  const downloadTiles = tiles.filter(function (tile) { return tile[0] !== 2 })
  // Get suffixes of these tiles
  const suffixes = downloadTiles.map(i => getTileUrlSuffix(i))
  return suffixes
}

/**
 * Goes through each coordinate, each line, each point, and removes (in place)
 * latlngs that are outside bounding box
 * It then removes array of points if empty, array of lines if empty, array of coordinates if empty,
 * and finally, if that feature has no coordinates, it removes the feature from the array of features
 *
 * @param {array} features - geojson from OSMLR geometry tile
 * @param {object} bounds - the latlngs of the bounding box
 * @returns {array} - features that are within the bounding box
*/

function withinBbox (features, bounds) {
  // We need to check the geometry.coordinates to check if they're within bounds
  // If not within bound, remove entire feature from features
  const buffer = 0.0003
  const coordinates = features.map(feature => {
    return feature.geometry.coordinates
  })
  // Coordinates have array of lines
  // Lines have array of points
  // Points have one array of latlngs [lng, lat]
  for (let lineIndex = coordinates.length - 1; lineIndex >= 0; lineIndex--) {
    const line = coordinates[lineIndex]
    for (let pointsIndex = line.length - 1; pointsIndex >= 0; pointsIndex--) {
      const points = line[pointsIndex]
      for (let coordIndex = points.length - 1; coordIndex >= 0; coordIndex--) {
        const point = points[coordIndex]
        const lat = point[1]
        const lng = point[0]
        // Checking if latlng is within bounding box
        // If not remove from points
        if (lng < Number(bounds.west) - buffer || lng > Number(bounds.east) + buffer || lat < Number(bounds.south) - buffer || lat > Number(bounds.north) + buffer) {
          points.splice(coordIndex, 1)
        }
      }
      // If no points in line, remove from line
      if (points.length === 0) { line.splice(pointsIndex, 1) }
    }
    // If no lines in coordinates, remove from coordinates
    if (line.length === 0) { coordinates.splice(lineIndex, 1) }
  }

  // If no coordinates, remove entire feature from array of features
  for (let i = features.length - 1; i >= 0; i--) {
    const feature = features[i]
    if (feature.geometry.coordinates.length === 0) { features.splice(i, 1) }
  }
}

export function showRegion (bounds) {
  // If bounds are cleared, remove data source from tangram
  if (!bounds) {
    const scene = getCurrentScene()
    delete scene.sources.routes
    setCurrentScene(scene)
    return
  }

  // First, convert bounds to waypoints
  // This way we can get the bounding box from valhalla and suffixes
  const waypoints = [L.latLng(bounds.south, bounds.west), L.latLng(bounds.north, bounds.east)]
  // Go get route using Valhalla
  getRoute(host, waypoints)
    // After getting route, get the bounding box and the relevant tiles from box
    .then((response) => {
      const bbox = response.trip.summary
      const suffixes = getSuffixes(bbox)
      return suffixes
    })
    // Second, fetch the OSMLR Geometry tiles using the suffixes
    .then((suffixes) => {
      store.dispatch(startLoading())
      fetchOSMLRGeometryTiles(suffixes)
        .then((results) => {
          const features = results.features
          // Remove from geojson, routes outside bounding box (bounds)
          withinBbox(features, bounds)

          // Get segment IDs to use later
          const segmentIds = features.map(key => {
            return key.properties.osmlr_id
          })
          // Removing duplicates of segment IDs
          const parsedIds = uniq(segmentIds).map(parseSegmentId)
          // Using segmentIds, fetch data tiles
          fetchDataTiles(parsedIds)
            .then((tiles) => {
              parsedIds.forEach((item, index) => {
                try {
                  const segmentId = item.segment
                  const subtiles = tiles[item.level][item.tile]
                  const subtileIds = Object.keys(subtiles)
                  for (let i = 0, j = subtileIds.length; i < j; i++) {
                    const tile = subtiles[subtileIds[i]]
                    const upperBounds = (i === j - 1) ? tile.totalSegments : (tile.startSegmentIndex + tile.subtileSegments)
                    // if this is the right tile, get the reference speed for the
                    // current segment and attach it to the item.
                    if (segmentId > tile.startSegmentIndex && segmentId <= upperBounds) {
                      // Test hour
                      const hour = store.getState().app.tempHour
                      // Get the local id of the segment
                      // (eg. id 21000 is local id 1000 if tile segment size is 10000)
                      const subtileSegmentId = segmentId % tile.subtileSegments
                      // There is one array for every attribute. Divide unitSize by
                      // entrySize to know how many entries belong to each segment,
                      // and find the base index for that segment
                      const entryBaseIndex = subtileSegmentId * (tile.unitSize / tile.entrySize)
                      // Add the desired hour (0-index) to get the correct index value
                      const desiredIndex = entryBaseIndex + hour

                      // Append the speed to the features.properties for tangram to render later
                      item.speed = tile.speeds[desiredIndex]
                      features[index].properties.speed = tile.speeds[desiredIndex]
                      break
                    }
                  }
                } catch (e) {}
              })
              console.log(results, parsedIds)
              setDataSource('routes', { type: 'GeoJSON', data: results })
            })
          store.dispatch(stopLoading())
        })
        .catch((error) => {
          console.log('[fetchDataTiles error]', error)
          store.dispatch(stopLoading())
        })
    })
}

/**
 * Fetch requested OSMLR geometry tiles and return its result as a
 * single GeoJSON file.
 *
 * @param {Array<String>} suffixes - an array of tile path suffixes,
 *            in the form of `x/xxx/xxx`.
 * @return {Promise} - a Promise is returned passing the value of all
 *            OSMLR geometry tiles, merged into a single GeoJSON.
 */
function fetchOSMLRGeometryTiles (suffixes) {
  const urls = suffixes.map(suffix => `${OSMLR_TILE_PATH}${suffix}.json`)
  const fetchTiles = urls.map(url => fetch(url).then(res => res.json()))
  // Results is an array of all GeoJSON tiles. Next, merge into one file
  // and return the result as a single GeoJSON.
  return Promise.all(fetchTiles).then(merge)
}
