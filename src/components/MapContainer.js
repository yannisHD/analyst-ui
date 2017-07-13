import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import Map from './Map'
import RouteMarkers from './Map/RouteMarkers'
import RouteLine from './Map/RouteLine'
import { setWaypoint, removeWaypoint, setRoute } from '../store/reducers/route'
import { formatLocations } from '../lib/valhalla'

import polyline from '@mapbox/polyline'

class MapContainer extends React.Component {
  static propTypes = {
    dispatch: PropTypes.func.isRequired,
    className: PropTypes.string,
    config: PropTypes.object,
    route: PropTypes.object
  }

  constructor (props) {
    super(props)

    this.onClick = this.onClick.bind(this)
    this.onClickWaypoint = this.onClickWaypoint.bind(this)
  }

  onClick (event) {
    this.props.dispatch(setWaypoint(event.latlng))
    this.showRoute()
  }

  /**
   * This handler function is passed to the RouteMarkers component, which eats
   * the original event argument and passes the latlng value of the marker instead.
   */
  onClickWaypoint (latlng) {
    this.props.dispatch(removeWaypoint(latlng))
    this.showRoute()
  }

  showRoute () {
    getAndDisplayRoutes(this.props.route, this.props.dispatch)
  }

  render () {
    const config = this.props.config

    return (
      <div className={this.props.className}>
        <Map
          config={config}
          center={config.center}
          zoom={config.zoom}
          onClick={this.onClick}
        >
          <RouteLine positions={this.props.route.positions} />
          <RouteMarkers waypoints={this.props.route.waypoints} onClick={this.onClickWaypoint} />
        </Map>
      </div>
    )
  }
}

function mapStateToProps (state) {
  return {
    config: state.config,
    route: state.route
  }
}

export default connect(mapStateToProps)(MapContainer)

/* TODO move elsewhere */

function getAndDisplayRoutes (route, dispatch) {
  const waypoints = route.waypoints

  if (waypoints.length <= 1) return

  const json = {
    locations: formatLocations(waypoints),
    costing: 'auto'
  }
  const server = 'routing-prod.opentraffic.io'
  const url = `https://${server}/route?json=${JSON.stringify(json)}`

  window.fetch(url)
    .then(response => {
      return response.json()
    })
    .then(response => {
      const coordinates = []

      for (let i = 0; i < response.trip.legs.length; i++) {
        const coord = polyline.decode(response.trip.legs[i].shape, 6)

        for (let k = 0; k < coord.length; k++) {
          coordinates.push({ lat: coord[k][0], lng: coord[k][1] })
        }
      }

      dispatch(setRoute(coordinates))
    })
}
