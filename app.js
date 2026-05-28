const mapData = window.MAP_DATA;

if (!mapData) {
  throw new Error("Map data is missing. Run the data build before opening the site.");
}

const REGION_BY_PROVINCE = {
  "กำแพงเพชร": "north",
  "ชัยนาท": "central_south",
  "เชียงใหม่": "north",
  "นครปฐม": "central_south",
  "นครราชสีมา": "northeast",
  "นครศรีธรรมราช": "central_south",
  "ประจวบคีรีขันธ์": "central_south",
  "ปราจีนบุรี": "central_south",
  "พะเยา": "north",
  "พิษณุโลก": "north",
  "เพชรบูรณ์": "north",
  "ราชบุรี": "central_south",
  "ลำปาง": "north",
  "ลำพูน": "north",
  "สระบุรี": "central_south",
  "สระแก้ว": "central_south",
  "อุบลราชธานี": "northeast",
  "กรุงเทพมหานคร": "central_south",
  "กาญจนบุรี": "central_south",
  "ฉะเชิงเทรา": "central_south",
};

const ROUTE_DEFINITIONS = [
  {
    key: "northToNortheast",
    label: "North -> Northeastern",
    color: "#d8b96e",
    includeRegions: new Set(["north", "northeast"]),
    summary: "Northern locations continue toward Northeastern Thailand.",
  },
  {
    key: "northToCentralSouth",
    label: "North -> Central & Southern",
    color: "#55c78e",
    includeRegions: new Set(["north", "central_south"]),
    summary: "Northern locations continue toward Central and Southern Thailand.",
  },
];

const elements = {
  sourceFile: document.getElementById("source-file"),
  totalRecords: document.getElementById("stat-total-records"),
  mappedRecords: document.getElementById("stat-mapped-records"),
  locationCount: document.getElementById("stat-location-count"),
  provinceCount: document.getElementById("stat-province-count"),
  searchInput: document.getElementById("search-input"),
  majorFilter: document.getElementById("major-filter"),
  provinceFilter: document.getElementById("province-filter"),
  resetButton: document.getElementById("reset-filters"),
  buildRoutesButton: document.getElementById("build-routes"),
  clearPathButton: document.getElementById("clear-path"),
  resultsTitle: document.getElementById("results-title"),
  locationList: document.getElementById("location-list"),
  coverageNote: document.getElementById("coverage-note"),
  missingEstablishments: document.getElementById("missing-establishments"),
  routeStatus: document.getElementById("route-status"),
  routeGroups: document.getElementById("route-groups"),
};

const numberFormat = new Intl.NumberFormat("en-US");
const distanceFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

const map = L.map("map", {
  zoomControl: true,
  scrollWheelZoom: true,
}).setView([15.87, 100.9925], 6);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

const locationLookup = new Map();
const markerLookup = new Map();
let routePolylines = [];
let activeLocationId = null;
let currentVisibleLocations = [];
let routeState = {
  enabled: false,
  routes: [],
};

initialize();

function initialize() {
  elements.sourceFile.textContent = mapData.meta.sourceFile;
  elements.totalRecords.textContent = numberFormat.format(mapData.meta.totalRecords);
  elements.mappedRecords.textContent = numberFormat.format(mapData.meta.mappedRecords);

  populateFilter(elements.majorFilter, collectMajors(mapData.locations), "All majors");
  populateFilter(elements.provinceFilter, collectProvinces(mapData.locations), "All provinces");
  renderCoverage();
  renderRoutePanel();
  renderLocations();
  bindEvents();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", renderLocations);
  elements.majorFilter.addEventListener("change", renderLocations);
  elements.provinceFilter.addEventListener("change", renderLocations);
  elements.resetButton.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.majorFilter.value = "";
    elements.provinceFilter.value = "";
    activeLocationId = null;
    renderLocations();
  });
  elements.buildRoutesButton.addEventListener("click", () => {
    routeState.enabled = true;
    buildAndRenderRegionalRoutes();
  });
  elements.clearPathButton.addEventListener("click", clearRoutes);
}

function collectMajors(locations) {
  return [...new Set(locations.flatMap((location) => location.majors))].sort((a, b) =>
    a.localeCompare(b, "th")
  );
}

function collectProvinces(locations) {
  return [...new Set(locations.map((location) => location.province))].sort((a, b) =>
    a.localeCompare(b, "th")
  );
}

function populateFilter(select, values, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function renderCoverage() {
  const missingCount = mapData.meta.unmappedRecords;
  elements.coverageNote.textContent = `${numberFormat.format(
    missingCount
  )} student records could not be mapped because the workbook does not contain enough address detail. The map uses province-centered placement for the ${numberFormat.format(
    mapData.meta.mappedRecords
  )} records that do contain usable location text.`;

  elements.missingEstablishments.innerHTML = "";
  mapData.stats.topMissingEstablishments.forEach((item) => {
    const block = document.createElement("article");
    block.className = "missing-item";
    block.innerHTML = `
      <strong>${escapeHtml(item.establishment)}</strong>
      <span>${numberFormat.format(item.studentCount)} student record${item.studentCount === 1 ? "" : "s"} without a map address</span>
    `;
    elements.missingEstablishments.append(block);
  });
}

function getFilters() {
  return {
    search: elements.searchInput.value.trim().toLowerCase(),
    major: elements.majorFilter.value,
    province: elements.provinceFilter.value,
  };
}

function renderLocations() {
  const filters = getFilters();
  currentVisibleLocations = mapData.locations.filter((location) => matchesFilters(location, filters));

  if (
    activeLocationId &&
    !currentVisibleLocations.some((location) => location.id === activeLocationId)
  ) {
    activeLocationId = null;
  }

  renderStatsForVisibleLocations(currentVisibleLocations);
  renderMarkers(currentVisibleLocations);

  if (routeState.enabled) {
    buildAndRenderRegionalRoutes();
    return;
  }

  renderLocationCards(currentVisibleLocations);
  renderRoutePanel();
}

function matchesFilters(location, filters) {
  const haystack = [
    location.title,
    location.address,
    location.province,
    ...location.majors,
    ...location.establishments,
    ...location.students.map((student) => student.name),
  ]
    .join(" ")
    .toLowerCase();

  const matchesSearch = !filters.search || haystack.includes(filters.search);
  const matchesMajor = !filters.major || location.majors.includes(filters.major);
  const matchesProvince = !filters.province || location.province === filters.province;

  return matchesSearch && matchesMajor && matchesProvince;
}

function renderStatsForVisibleLocations(locations) {
  const visibleStudents = locations.reduce((sum, location) => sum + location.studentCount, 0);
  const provinces = new Set(locations.map((location) => location.province));

  elements.locationCount.textContent = numberFormat.format(locations.length);
  elements.provinceCount.textContent = numberFormat.format(provinces.size);
  elements.resultsTitle.textContent = `${numberFormat.format(locations.length)} visible location${
    locations.length === 1 ? "" : "s"
  }`;

  if (!elements.searchInput.value && !elements.majorFilter.value && !elements.provinceFilter.value) {
    elements.mappedRecords.textContent = numberFormat.format(mapData.meta.mappedRecords);
    return;
  }

  elements.mappedRecords.textContent = numberFormat.format(visibleStudents);
}

function renderLocationCards(locations) {
  elements.locationList.innerHTML = "";

  if (!locations.length) {
    elements.locationList.innerHTML = `
      <div class="empty-state">
        No locations match the current filters. Try clearing the search term or switching to another province.
      </div>
    `;
    return;
  }

  const routeBadgeMap = buildRouteBadgeMap();

  locations.forEach((location) => {
    const companyLabel = location.establishmentCount === 1 ? "company" : "companies";
    const routeBadges = (routeBadgeMap.get(location.id) || [])
      .map((badge) => `<span class="location-badge">${escapeHtml(badge)}</span>`)
      .join("");

    const card = document.createElement("article");
    card.className = `location-card${location.id === activeLocationId ? " is-active" : ""}`;
    card.dataset.locationId = location.id;
    card.innerHTML = `
      <h3>${escapeHtml(location.title)}</h3>
      <p>${escapeHtml(location.address)}</p>
      <div class="location-meta">
        <span class="location-badge">${escapeHtml(location.province)}</span>
        <span class="location-badge">${numberFormat.format(location.studentCount)} students</span>
        <span class="location-badge">${numberFormat.format(location.establishmentCount)} ${companyLabel}</span>
        ${routeBadges}
      </div>
    `;

    card.addEventListener("click", () => focusLocation(location.id));
    elements.locationList.append(card);
  });
}

function buildRouteBadgeMap() {
  const badgeMap = new Map();

  if (!routeState.enabled) {
    return badgeMap;
  }

  routeState.routes.forEach((route) => {
    route.orderedIds.forEach((locationId, index) => {
      const label = `${route.shortLabel} ${index + 1}`;
      const badges = badgeMap.get(locationId) || [];
      badges.push(label);
      badgeMap.set(locationId, badges);
    });
  });

  return badgeMap;
}

function renderMarkers(locations) {
  markerLookup.forEach((marker) => marker.remove());
  markerLookup.clear();
  locationLookup.clear();

  if (!locations.length) {
    clearRouteLines();
    return;
  }

  const bounds = [];

  locations.forEach((location) => {
    const displayCoords = getDisplayCoords(location);
    const locationWithDisplay = { ...location, displayCoords };
    locationLookup.set(location.id, locationWithDisplay);

    const marker = L.marker([displayCoords.lat, displayCoords.lng], {
      icon: L.divIcon({
        className: "custom-div-icon",
        html: `<div class="marker-pin"><span>${location.studentCount}</span></div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 38],
        popupAnchor: [0, -34],
      }),
    });

    marker.bindPopup(buildPopup(location));
    marker.on("click", () => {
      activeLocationId = location.id;
      syncActiveSelections();
    });
    marker.addTo(map);

    markerLookup.set(location.id, marker);
    bounds.push([displayCoords.lat, displayCoords.lng]);
  });

  fitMapToBounds(bounds);
}

function buildAndRenderRegionalRoutes() {
  const routeResults = ROUTE_DEFINITIONS.map((definition) => buildRouteForDefinition(definition)).filter(
    Boolean
  );

  routeState.routes = routeResults;
  drawRoutes(routeResults);
  renderLocationCards(currentVisibleLocations);
  renderRoutePanel(routeResults);
  syncActiveSelections();
}

function buildRouteForDefinition(definition) {
  const routeLocations = currentVisibleLocations.filter((location) =>
    definition.includeRegions.has(getRegionForProvince(location.province))
  );

  if (!routeLocations.length) {
    return {
      ...definition,
      shortLabel: getShortLabel(definition.key),
      orderedIds: [],
      totalDistanceKm: 0,
      routeLocations: [],
      message: "No visible locations for this regional path.",
    };
  }

  if (routeLocations.length === 1) {
    const onlyLocation = routeLocations[0];
    return {
      ...definition,
      shortLabel: getShortLabel(definition.key),
      orderedIds: [onlyLocation.id],
      totalDistanceKm: 0,
      routeLocations,
      startLocation: onlyLocation,
      endLocation: onlyLocation,
      message: "Only one visible location is available for this path.",
    };
  }

  const startLocation = pickRouteStartLocation(routeLocations);
  const pathResult = computeHamiltonianPath(routeLocations, startLocation.id);

  return {
    ...definition,
    shortLabel: getShortLabel(definition.key),
    orderedIds: pathResult.locations.map((location) => location.id),
    totalDistanceKm: pathResult.totalDistanceKm,
    routeLocations: pathResult.locations,
    startLocation: pathResult.locations[0],
    endLocation: pathResult.locations[pathResult.locations.length - 1],
    message: definition.summary,
  };
}

function pickRouteStartLocation(locations) {
  const activeLocation = locations.find((location) => location.id === activeLocationId);
  if (activeLocation && getRegionForProvince(activeLocation.province) === "north") {
    return activeLocation;
  }

  const northernLocations = locations.filter(
    (location) => getRegionForProvince(location.province) === "north"
  );

  if (northernLocations.length) {
    return northernLocations.sort((a, b) => {
      const aCoords = getDisplayCoords(a);
      const bCoords = getDisplayCoords(b);
      return bCoords.lat - aCoords.lat;
    })[0];
  }

  return activeLocation || locations[0];
}

function drawRoutes(routes) {
  clearRouteLines();

  const pointsForBounds = [];

  routes.forEach((route) => {
    if (route.routeLocations.length < 2) {
      return;
    }

    const routePoints = route.routeLocations.map((location) => {
      const displayLocation = locationLookup.get(location.id) || {
        displayCoords: getDisplayCoords(location),
      };
      const point = [displayLocation.displayCoords.lat, displayLocation.displayCoords.lng];
      pointsForBounds.push(point);
      return point;
    });

    const polyline = L.polyline(routePoints, {
      color: route.color,
      weight: 5,
      opacity: 0.9,
      className: "route-line",
      lineJoin: "round",
    }).addTo(map);

    routePolylines.push(polyline);
  });

  if (pointsForBounds.length) {
    fitMapToBounds(pointsForBounds);
  }
}

function clearRoutes() {
  routeState = {
    enabled: false,
    routes: [],
  };
  clearRouteLines();
  renderLocationCards(currentVisibleLocations);
  renderRoutePanel();
  syncActiveSelections();
}

function clearRouteLines() {
  routePolylines.forEach((polyline) => polyline.remove());
  routePolylines = [];
}

function renderRoutePanel(routes = []) {
  if (!routeState.enabled) {
    elements.routeStatus.textContent =
      "Build two paths from the northern locations: one toward Northeastern Thailand and one toward Central and Southern Thailand.";
    elements.routeGroups.innerHTML = `
      <div class="empty-state">
        The regional planner uses the locations currently visible after filtering. Click a northern location first if you want both routes to start there.
      </div>
    `;
    return;
  }

  elements.routeStatus.textContent =
    "These are approximate Hamiltonian paths built from the visible locations. Each route visits every location in its regional group exactly once.";

  elements.routeGroups.innerHTML = "";

  routes.forEach((route) => {
    const group = document.createElement("section");
    group.className = "route-group";
    group.style.setProperty("--route-color", route.color);

    if (!route.routeLocations.length) {
      group.innerHTML = `
        <div class="route-group-header">
          <div>
            <h3>${escapeHtml(route.label)}</h3>
            <p>${escapeHtml(route.message)}</p>
          </div>
          <div class="route-group-line"></div>
        </div>
      `;
      elements.routeGroups.append(group);
      return;
    }

    const metrics = `
      <div class="route-metrics">
        <span class="location-badge">${numberFormat.format(route.routeLocations.length)} stops</span>
        <span class="location-badge">${distanceFormat.format(route.totalDistanceKm)} km</span>
        <span class="location-badge">Start: ${escapeHtml(route.startLocation.title)}</span>
        <span class="location-badge">End: ${escapeHtml(route.endLocation.title)}</span>
      </div>
    `;

    const listMarkup =
      route.routeLocations.length > 1
        ? route.routeLocations
            .map(
              (location, index) => `
                <article class="route-stop${
                  location.id === activeLocationId ? " is-active" : ""
                }" data-location-id="${escapeAttribute(location.id)}" style="--route-color: ${route.color}">
                  <div class="route-stop-index">${index + 1}</div>
                  <div>
                    <h3>${escapeHtml(location.title)}</h3>
                    <p>${escapeHtml(location.province)} - ${escapeHtml(location.address)}</p>
                  </div>
                </article>
              `
            )
            .join("")
        : `
          <div class="empty-state">
            ${escapeHtml(route.message)}
          </div>
        `;

    group.innerHTML = `
      <div class="route-group-header">
        <div>
          <h3>${escapeHtml(route.label)}</h3>
          <p>${escapeHtml(route.message)}</p>
        </div>
        <div class="route-group-line"></div>
      </div>
      ${metrics}
      <div class="route-list">${listMarkup}</div>
    `;

    group.querySelectorAll(".route-stop").forEach((stop) => {
      stop.addEventListener("click", () => focusLocation(stop.dataset.locationId));
    });

    elements.routeGroups.append(group);
  });
}

function focusLocation(locationId) {
  const marker = markerLookup.get(locationId);
  const location = locationLookup.get(locationId);
  if (!marker || !location) {
    return;
  }

  activeLocationId = locationId;
  syncActiveSelections();
  map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 8), { duration: 0.9 });
  marker.openPopup();
}

function syncActiveSelections() {
  document.querySelectorAll(".location-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.locationId === activeLocationId);
  });

  document.querySelectorAll(".route-stop").forEach((stop) => {
    stop.classList.toggle("is-active", stop.dataset.locationId === activeLocationId);
  });
}

function buildPopup(location) {
  const previewStudents = location.students.slice(0, 6);
  const remaining = location.students.length - previewStudents.length;

  return `
    <div>
      <h3 class="popup-title">${escapeHtml(location.title)}</h3>
      <p class="popup-subtitle">${escapeHtml(location.address)}</p>
      <p class="popup-subtitle">${escapeHtml(location.province)} - ${numberFormat.format(
        location.studentCount
      )} students</p>
      <ul class="popup-list">
        ${previewStudents
          .map(
            (student) =>
              `<li>${escapeHtml(student.name)} <strong>(${escapeHtml(student.major)})</strong></li>`
          )
          .join("")}
      </ul>
      ${
        remaining > 0
          ? `<p class="popup-footer">+ ${numberFormat.format(remaining)} more student records in this location</p>`
          : `<p class="popup-footer">Approximate marker based on province-level placement</p>`
      }
    </div>
  `;
}

function computeHamiltonianPath(locations, startLocationId) {
  const enriched = locations.map((location) => {
    const displayLocation = locationLookup.get(location.id) || {
      displayCoords: getDisplayCoords(location),
    };
    return {
      ...location,
      displayCoords: displayLocation.displayCoords,
    };
  });

  const startIndex = Math.max(
    enriched.findIndex((location) => location.id === startLocationId),
    0
  );

  const ordered = buildNearestNeighborPath(enriched, startIndex);
  improvePathWithTwoOpt(ordered);

  return {
    locations: ordered,
    totalDistanceKm: getPathDistance(ordered),
  };
}

function buildNearestNeighborPath(locations, startIndex) {
  const unvisited = new Set(locations.map((_, index) => index));
  const path = [];
  let currentIndex = startIndex;

  while (unvisited.size) {
    path.push(locations[currentIndex]);
    unvisited.delete(currentIndex);

    if (!unvisited.size) {
      break;
    }

    let nextIndex = null;
    let shortestDistance = Number.POSITIVE_INFINITY;

    unvisited.forEach((candidateIndex) => {
      const candidateDistance = getDistanceKm(
        locations[currentIndex].displayCoords,
        locations[candidateIndex].displayCoords
      );
      if (candidateDistance < shortestDistance) {
        shortestDistance = candidateDistance;
        nextIndex = candidateIndex;
      }
    });

    currentIndex = nextIndex;
  }

  return path;
}

function improvePathWithTwoOpt(path) {
  if (path.length < 4) {
    return;
  }

  let improved = true;
  let passCount = 0;

  while (improved && passCount < 8) {
    improved = false;
    passCount += 1;

    for (let i = 1; i < path.length - 2; i += 1) {
      for (let j = i + 1; j < path.length - 1; j += 1) {
        const currentDistance =
          getDistanceKm(path[i - 1].displayCoords, path[i].displayCoords) +
          getDistanceKm(path[j].displayCoords, path[j + 1].displayCoords);
        const swappedDistance =
          getDistanceKm(path[i - 1].displayCoords, path[j].displayCoords) +
          getDistanceKm(path[i].displayCoords, path[j + 1].displayCoords);

        if (swappedDistance + 0.05 < currentDistance) {
          reverseSegment(path, i, j);
          improved = true;
        }
      }
    }
  }
}

function reverseSegment(path, startIndex, endIndex) {
  while (startIndex < endIndex) {
    const temporary = path[startIndex];
    path[startIndex] = path[endIndex];
    path[endIndex] = temporary;
    startIndex += 1;
    endIndex -= 1;
  }
}

function getPathDistance(path) {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += getDistanceKm(path[index - 1].displayCoords, path[index].displayCoords);
  }
  return total;
}

function getDistanceKm(a, b) {
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(b.lat - a.lat);
  const dLng = degreesToRadians(b.lng - a.lng);
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function getDisplayCoords(location) {
  const [lat, lng] = createOffsetCoords(
    location.coords.lat,
    location.coords.lng,
    location.provinceIndex
  );
  return { lat, lng };
}

function fitMapToBounds(points) {
  if (!points.length) {
    return;
  }

  if (points.length === 1) {
    map.setView(points[0], 8);
    return;
  }

  map.fitBounds(points, { padding: [36, 36] });
}

function createOffsetCoords(lat, lng, index) {
  const position = Math.max(index - 1, 0);
  const ring = Math.floor(position / 6) + 1;
  const angle = (position % 6) * (Math.PI / 3);
  const latOffset = Math.sin(angle) * 0.2 * ring;
  const lngOffset = Math.cos(angle) * 0.22 * ring;

  return [lat + latOffset, lng + lngOffset];
}

function getRegionForProvince(province) {
  return REGION_BY_PROVINCE[province] || "central_south";
}

function getShortLabel(routeKey) {
  if (routeKey === "northToNortheast") {
    return "NE";
  }
  return "CS";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
