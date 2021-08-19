'use strict';
'require baseclass';
'require rpc';
'require network';
'require fs';
'require validation';

function applyMask(addr, mask, v6) {
	var words = v6 ? validation.parseIPv6(addr) : validation.parseIPv4(addr);

	if (!words || mask < 0 || mask > (v6 ? 128 : 32))
		return null;

	for (var i = 0; i < words.length; i++) {
		var b = Math.min(mask, v6 ? 16 : 8);
		words[i] &= ((1 << b) - 1);
		mask -= b;
	}

	return String.prototype.format.apply(
		v6 ? '%x:%x:%x:%x:%x:%x:%x:%x' : '%d.%d.%d.%d', words);
}

var callNetworkInterfaceDump = rpc.declare({
	object: 'network.interface',
	method: 'dump',
	expect: { interface: [] }
});

return baseclass.extend({
	title: _('Arp table'),

	params: {},

	load: function() {
		return Promise.all([
			callNetworkInterfaceDump(),
			L.resolveDefault(fs.exec('/sbin/ip', [ '-4', 'neigh', 'show' ]), {}),
			network.getDevices()
		]);
	},

	renderHtml: function() {

		var container_wapper = E('div', { 'class': 'router-status-lan dashboard-bg box-s1' });
		var container_box = E('div', { 'class': 'lan-info devices-list' });
		var container_deviceslist = E('table', { 'class': 'table assoclist devices-info' });

		container_box.appendChild(E('hr'));
		container_box.appendChild(this.neigh4tbl);
		container_wapper.appendChild(container_box);

		return container_wapper;
	},

	getNetworkByDevice(networks, dev, addr, mask, v6) {
		var addr_arrays = [ 'ipv4-address', 'ipv6-address', 'ipv6-prefix', 'ipv6-prefix-assignment', 'route' ],
		    matching_iface = null,
		    matching_prefix = -1;

		for (var i = 0; i < networks.length; i++) {
			if (!L.isObject(networks[i]))
				continue;

			if (networks[i].l3_device != dev && networks[i].device != dev)
				continue;

			for (var j = 0; j < addr_arrays.length; j++) {
				var addr_list = networks[i][addr_arrays[j]];

				if (!Array.isArray(addr_list) || addr_list.length == 0)
					continue;

				for (var k = 0; k < addr_list.length; k++) {
					var cmp_addr = addr_list[k].address || addr_list[k].target,
					    cmp_mask = addr_list[k].mask;

					if (cmp_addr == null)
						continue;

					var addr1 = applyMask(cmp_addr, cmp_mask, v6),
					    addr2 = applyMask(addr, cmp_mask, v6);

					if (addr1 != addr2 || mask < cmp_mask)
						continue;

					if (cmp_mask > matching_prefix) {
						matching_iface = networks[i].interface;
						matching_prefix = cmp_mask;
					}
				}
			}
		}

		return matching_iface;
	},

	parseNeigh: function(s, networks, v6) {
		var lines = s.trim().split(/\n/),
		    res = [];

		for (var i = 0; i < lines.length; i++) {
			var m = lines[i].match(/^([0-9a-f:.]+) (.+) (\S+)$/),
			    addr = m ? m[1] : null,
			    flags = m ? m[2].trim().split(/\s+/) : [],
			    state = (m ? m[3] : null) || 'FAILED';

			if (!addr || state == 'FAILED' || addr.match(/^fe[89a-f][0-9a-f]:/))
				continue;

			for (var j = 0; j < flags.length; j += 2)
				flags[flags[j]] = flags[j + 1];

			if (!flags.lladdr)
				continue;

			var net = this.getNetworkByDevice(networks, flags.dev, addr, v6 ? 128 : 32, v6);

			res.push([
				addr,
				flags.lladdr.toUpperCase(),
				E('span', { 'class': 'ifacebadge' }, [ net ? net : '(%s)'.format(flags.dev) ])
			]);
		}

		return res;
	},

	renderArpEntries: function(data) {
		var networks = data[0],
				ip4neigh = data[1].stdout || '';

		this.neigh4tbl = E('table', { 'class': 'table assoclist devices-info' }, [
			E('tr', { 'class': 'tr table-titles dashboard-bg' }, [
				E('th', { 'class': 'th nowrap' }, [ _('IPv4 address') ]),
				E('th', { 'class': 'th' }, [ _('MAC address') ]),
				E('th', { 'class': 'th' }, [ _('Interface') ])
			])
		]);
		cbi_update_table(this.neigh4tbl, this.parseNeigh(ip4neigh, networks, false));
	},

	render: function(data) {
		this.renderArpEntries(data);
		console.log(data);
		return this.renderHtml();
	}
});
